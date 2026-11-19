import { createContext } from 'react';

// The chat the entries drawn below belong to, for the cards that act on it: several chats can be on screen at once.
export const ChatSessionId = createContext('');
