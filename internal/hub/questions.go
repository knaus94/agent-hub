package hub

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strconv"
	"strings"

	"github.com/knaus94/agent-hub/internal/protocol"
)

// setCommands keeps the slash commands an agent advertises, as Zed lists them after "/".
func (t *Timeline) setCommands(s *session, update fields) {
	values, _ := update.array("availableCommands")
	commands := make([]protocol.Command, 0, len(values))
	for _, value := range values {
		command := object(value)
		name := deref(command.str("name"))
		if name == "" {
			continue
		}
		commands = append(commands, protocol.Command{Name: name, Description: deref(command.str("description")), Hint: command.object("input").str("hint")})
	}
	s.commands = commands
	t.changes.Commands[s.id] = true
}

func (t *Timeline) Commands(sessionID string) []protocol.Command {
	if s := t.sessions[sessionID]; s != nil {
		return s.commands
	}
	return nil
}

func (t *Timeline) ask(src *source, s *session, id json.RawMessage, question protocol.QuestionEntry) int {
	question.Kind = "question"
	question.ID = t.nextID(s)
	question.Status = "pending"
	if question.Options == nil {
		question.Options = []protocol.QuestionOption{}
	}
	if question.Fields == nil {
		question.Fields = []protocol.QuestionField{}
	}
	index := t.push(s, question)
	src.questions[string(id)] = questionRef{s.id, index}
	s.pending[index] = true
	t.alert(src, s, "ask", question.Message)
	return index
}

func (t *Timeline) askPermission(src *source, s *session, id json.RawMessage, params fields) {
	values, _ := params.array("options")
	options := make([]protocol.QuestionOption, 0, len(values))
	for _, value := range values {
		option := object(value)
		if optionID := deref(option.str("optionId")); optionID != "" {
			options = append(options, protocol.QuestionOption{ID: optionID, Label: deref(option.str("name")), Kind: option.str("kind")})
		}
	}
	t.ask(src, s, id, protocol.QuestionEntry{Mode: "permission", Message: deref(params.object("toolCall").str("title")), Options: options})
}

func (t *Timeline) askForm(src *source, s *session, id json.RawMessage, params fields) {
	question := protocol.QuestionEntry{Message: deref(params.str("message")), URL: params.str("url")}
	if deref(params.str("mode")) == "url" {
		question.Mode = "url"
	} else {
		question.Mode = "form"
		question.Fields = formFields(params["requestedSchema"])
	}
	index := t.ask(src, s, id, question)
	if elicitationID := deref(params.str("elicitationId")); elicitationID != "" {
		src.elicitations[elicitationID] = questionRef{s.id, index}
	}
}

// formFields reads an elicitation's JSON schema in the order its properties were written: a question's options come
// before its free-text "Other" field.
func formFields(schema json.RawMessage) []protocol.QuestionField {
	properties := object(schema)["properties"]
	keys := orderedKeys(properties)
	byKey := object(properties)
	result := make([]protocol.QuestionField, 0, len(keys))
	for _, key := range keys {
		property := byKey.object(key)
		field := protocol.QuestionField{Key: key, Kind: "text", Type: deref(property.str("type")), Title: property.str("title"), Description: property.str("description")}
		options := choices(property)
		if field.Type == "array" {
			field.Multiple = true
			options = choices(property.object("items"))
		}
		if field.Type == "boolean" {
			options = []protocol.QuestionOption{{ID: "true", Label: "Да"}, {ID: "false", Label: "Нет"}}
		}
		if len(options) > 0 {
			field.Kind = "choice"
			field.Options = options
		} else {
			field.Options = []protocol.QuestionOption{}
		}
		result = append(result, field)
	}
	return result
}

// choices reads the options of a schema: titled oneOf/anyOf constants, or a plain enum.
func choices(schema fields) []protocol.QuestionOption {
	var options []protocol.QuestionOption
	for _, key := range []string{"oneOf", "anyOf"} {
		values, _ := schema.array(key)
		for _, value := range values {
			option := object(value)
			if constant := option.str("const"); constant != nil {
				label := deref(option.str("title"))
				if label == "" {
					label = *constant
				}
				options = append(options, protocol.QuestionOption{ID: *constant, Label: label, Description: option.str("description")})
			}
		}
	}
	if len(options) == 0 {
		values, _ := schema.array("enum")
		for _, value := range values {
			var text string
			if json.Unmarshal(value, &text) == nil {
				options = append(options, protocol.QuestionOption{ID: text, Label: text})
			}
		}
	}
	return options
}

func orderedKeys(raw json.RawMessage) []string {
	decoder := json.NewDecoder(bytes.NewReader(raw))
	if token, err := decoder.Token(); err != nil || token != json.Delim('{') {
		return nil
	}
	var keys []string
	for decoder.More() {
		token, err := decoder.Token()
		if err != nil {
			return keys
		}
		key, _ := token.(string)
		keys = append(keys, key)
		var skip json.RawMessage
		if decoder.Decode(&skip) != nil {
			return keys
		}
	}
	return keys
}

// answered marks a question resolved by whoever replied first: Zed, the hub's own client, or a relay for the phone.
func (t *Timeline) answered(src *source, m *message) {
	ref, ok := src.questions[string(m.ID)]
	if !ok {
		return
	}
	delete(src.questions, string(m.ID))
	t.resolve(ref, "answered", describeAnswer(t.question(ref), m))
}

func (t *Timeline) completeElicitation(src *source, elicitationID string) {
	if ref, ok := src.elicitations[elicitationID]; ok {
		delete(src.elicitations, elicitationID)
		t.resolve(ref, "answered", nil)
	}
}

// withdrawn retires a question the agent took back, as it does when its turn is cancelled.
func (t *Timeline) withdrawn(src *source, requestID json.RawMessage) {
	key := string(bytes.TrimSpace(requestID))
	if ref, ok := src.questions[key]; ok {
		delete(src.questions, key)
		t.resolve(ref, "cancelled", nil)
	}
}

// forgetQuestions drops the references into a session's entries before the agent replays them.
func (t *Timeline) forgetQuestions(src *source, s *session) {
	clear(s.pending)
	maps.DeleteFunc(src.questions, func(_ string, ref questionRef) bool { return ref.sessionID == s.id })
	maps.DeleteFunc(src.elicitations, func(_ string, ref questionRef) bool { return ref.sessionID == s.id })
}

// closeQuestions retires the questions of a turn that ended without them being answered.
func (t *Timeline) closeQuestions(s *session) {
	for index := range s.pending {
		t.resolve(questionRef{s.id, index}, "cancelled", nil)
	}
}

func (t *Timeline) question(ref questionRef) *protocol.QuestionEntry {
	s := t.sessions[ref.sessionID]
	if s == nil || ref.index >= len(s.entries) {
		return nil
	}
	if question, ok := s.entries[ref.index].(protocol.QuestionEntry); ok {
		return &question
	}
	return nil
}

func (t *Timeline) resolve(ref questionRef, status string, answer *string) {
	question := t.question(ref)
	if question == nil || question.Status != "pending" {
		return
	}
	s := t.sessions[ref.sessionID]
	delete(s.pending, ref.index)
	question.Status = status
	question.Answer = answer
	t.replace(s, ref.index, *question)
}

// describeAnswer turns a reply into the words shown on the answered card.
func describeAnswer(question *protocol.QuestionEntry, m *message) *string {
	if question == nil || present(m.Error) {
		return nil
	}
	result := object(m.Result)
	var text string
	if question.Mode == "permission" {
		chosen := deref(result.object("outcome").str("optionId"))
		for _, option := range question.Options {
			if option.ID == chosen {
				text = option.Label
			}
		}
	} else {
		switch action := deref(result.str("action")); action {
		case "accept":
			var parts []string
			content := result.object("content")
			for _, field := range question.Fields {
				if value, ok := content[field.Key]; ok {
					parts = append(parts, fieldAnswer(field, value))
				}
			}
			text = strings.Join(slicesWithout(parts, ""), "; ")
		case "decline":
			text = "Отклонено"
		case "cancel":
			text = "Отменено"
		}
	}
	if text == "" {
		return nil
	}
	return &text
}

func fieldAnswer(field protocol.QuestionField, value json.RawMessage) string {
	label := func(id string) string {
		for _, option := range field.Options {
			if option.ID == id {
				return option.Label
			}
		}
		return id
	}
	var single string
	if json.Unmarshal(value, &single) == nil {
		return label(single)
	}
	var flag bool
	if json.Unmarshal(value, &flag) == nil {
		return label(strconv.FormatBool(flag))
	}
	var many []string
	if json.Unmarshal(value, &many) == nil {
		labels := make([]string, len(many))
		for i, id := range many {
			labels[i] = label(id)
		}
		return strings.Join(labels, ", ")
	}
	return strings.TrimSpace(string(value))
}

func slicesWithout(values []string, unwanted string) []string {
	kept := values[:0]
	for _, value := range values {
		if value != unwanted {
			kept = append(kept, value)
		}
	}
	return kept
}

// Pending is a question still waiting, and where its answer has to go.
type Pending struct {
	SourceID  string
	RequestID json.RawMessage
	Question  protocol.QuestionEntry
}

// FindQuestion returns the open question shown as entryID in a session.
func (t *Timeline) FindQuestion(sessionID, entryID string) (*Pending, error) {
	s := t.sessions[sessionID]
	if s == nil {
		return nil, fmt.Errorf("no session %s", sessionID)
	}
	src := t.sources[s.sourceID]
	for requestID, ref := range src.questions {
		if ref.sessionID != sessionID {
			continue
		}
		if question := t.question(ref); question != nil && question.ID == entryID && question.Status == "pending" {
			return &Pending{SourceID: src.id, RequestID: json.RawMessage(requestID), Question: *question}, nil
		}
	}
	return nil, fmt.Errorf("question %s is not waiting", entryID)
}

type answerInput struct {
	OptionID string                     `json:"optionId"`
	Action   string                     `json:"action"`
	Content  map[string]json.RawMessage `json:"content"`
}

// answerResult builds the agent's reply from what the browser sent, accepting only what the question offered.
func answerResult(question protocol.QuestionEntry, response json.RawMessage) (json.RawMessage, error) {
	var input answerInput
	if err := json.Unmarshal(response, &input); err != nil {
		return nil, err
	}
	if question.Mode == "permission" {
		if !slices.ContainsFunc(question.Options, func(option protocol.QuestionOption) bool { return option.ID == input.OptionID }) {
			return nil, fmt.Errorf("no option %q", input.OptionID)
		}
		return json.Marshal(map[string]any{"outcome": map[string]string{"outcome": "selected", "optionId": input.OptionID}})
	}
	switch input.Action {
	case "decline", "cancel":
		return json.Marshal(map[string]string{"action": input.Action})
	case "accept":
	default:
		return nil, fmt.Errorf("unknown action %q", input.Action)
	}
	if question.Mode == "url" {
		return json.Marshal(map[string]string{"action": "accept"})
	}
	content := map[string]any{}
	for key, raw := range input.Content {
		index := slices.IndexFunc(question.Fields, func(field protocol.QuestionField) bool { return field.Key == key })
		if index < 0 {
			return nil, fmt.Errorf("no field %q", key)
		}
		value, err := fieldValue(question.Fields[index], raw)
		if err != nil {
			return nil, fmt.Errorf("field %q: %w", key, err)
		}
		if value != nil {
			content[key] = value
		}
	}
	return json.Marshal(map[string]any{"action": "accept", "content": content})
}

// fieldValue checks one answer against its field and gives it the type the schema asked for; nil leaves it out.
func fieldValue(field protocol.QuestionField, raw json.RawMessage) (any, error) {
	offered := func(id string) bool {
		return slices.ContainsFunc(field.Options, func(option protocol.QuestionOption) bool { return option.ID == id })
	}
	if field.Multiple {
		var picked []string
		if err := json.Unmarshal(raw, &picked); err != nil {
			return nil, err
		}
		if !slices.ContainsFunc(picked, func(id string) bool { return !offered(id) }) {
			return picked, nil
		}
		return nil, errors.New("not an offered option")
	}
	var text string
	if err := json.Unmarshal(raw, &text); err != nil {
		return nil, err
	}
	if field.Kind == "choice" {
		if !offered(text) {
			return nil, errors.New("not an offered option")
		}
		if field.Type == "boolean" {
			return text == "true", nil
		}
		return text, nil
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, nil
	}
	if field.Type == "number" || field.Type == "integer" {
		number, err := strconv.ParseFloat(text, 64)
		if err != nil || (field.Type == "integer" && number != float64(int64(number))) {
			return nil, errors.New("not a number")
		}
		return number, nil
	}
	return text, nil
}
