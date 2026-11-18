import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import Clutter from 'gi://Clutter';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const REFRESH_SECONDS = 15;
const AGENT_HUB = GLib.build_filenamev([GLib.get_home_dir(), '.local', 'bin', 'agent-hub']);

// Runs agent-hub and hands its output, or the last line it printed on failure, to done.
function run(args, cancellable, done) {
    try {
        const proc = Gio.Subprocess.new([AGENT_HUB, ...args], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
        proc.communicate_utf8_async(null, cancellable, (source, result) => {
            try {
                const [, stdout, stderr] = source.communicate_utf8_finish(result);
                if (!source.get_successful())
                    throw new Error(stderr.trim().split('\n').pop() || `agent-hub ${args[0]} failed`);
                done(stdout.trim(), null);
            } catch (e) {
                if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    done(null, e.message);
            }
        });
    } catch (e) {
        done(null, e.message);
    }
}

function host(url) {
    return url.replace(/^https:\/\//, '');
}

// Always in the top bar, as a plain icon in the panel's colour; a bright pill while anything is reachable from outside:
// the chats, or a local port with no login.
const Indicator = GObject.registerClass(
class Indicator extends PanelMenu.Button {
    _init(iconPath) {
        super._init(0.5, 'Agent Hub');
        this._cancellable = new Gio.Cancellable();
        this._shown = null;

        this._pill = new St.BoxLayout({style_class: 'ah-pill'});
        this._pill.add_child(new St.Icon({gicon: Gio.icon_new_for_string(iconPath), style_class: 'ah-pill-icon'}));
        this._label = new St.Label({style_class: 'ah-pill-label', y_align: Clutter.ActorAlign.CENTER, visible: false});
        this._pill.add_child(this._label);
        this.add_child(this._pill);

        // Off closes every public address, open ports included.
        this._switch = new PopupMenu.PopupSwitchMenuItem('Удалённый доступ', false);
        this._toggled = this._switch.connect('toggled', (_item, on) => this._command([on ? 'up' : 'down']));
        this.menu.addMenuItem(this._switch);
        const local = new PopupMenu.PopupMenuItem('Открыть на этом компьютере');
        local.connect('activate', () => this._command(['open']));
        this.menu.addMenuItem(local);
        this._section = new PopupMenu.PopupMenuSection();
        this.menu.addMenuItem(this._section);
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this.menu.addMenuItem(this._portItem());
        this.menu.connect('open-state-changed', (_menu, open) => {
            if (open)
                this.refresh();
        });

        this.refresh();
        this._timer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, REFRESH_SECONDS, () => {
            this.refresh();
            return GLib.SOURCE_CONTINUE;
        });
    }

    refresh() {
        if (this._running)
            return;
        this._running = true;
        run(['status'], this._cancellable, (stdout, error) => {
            this._running = false;
            if (error)
                return;
            // Rebuilt only on a change, so an open menu does not flicker under the pointer.
            if (stdout !== this._shown) {
                this._shown = stdout;
                this._render(JSON.parse(stdout));
            }
        });
    }

    _render({hub, url, shares}) {
        const exposed = hub || shares.length > 0;
        if (exposed)
            this._pill.add_style_class_name('ah-public');
        else
            this._pill.remove_style_class_name('ah-public');
        this._label.visible = exposed;
        this._label.text = [hub ? 'Hub' : null, shares.length ? `${shares.length} порт.` : null].filter(Boolean).join(' · ');
        // The switch reports every change of its state as toggled, also one made here to show the status.
        this._switch.block_signal_handler(this._toggled);
        this._switch.setToggleState(hub);
        this._switch.unblock_signal_handler(this._toggled);
        this._section.removeAll();
        if (hub)
            this._section.addMenuItem(this._addressItem(url ? `Чаты · ${host(url)}` : 'Чаты · подключаюсь…', url, null));
        for (const share of shares)
            this._section.addMenuItem(this._addressItem(`Порт ${share.port} · ${share.url ? host(share.url) : 'подключаюсь…'}`, share.url, share.port));
    }

    _addressItem(title, url, port) {
        const item = new PopupMenu.PopupSubMenuMenuItem(title);
        if (url) {
            const copy = new PopupMenu.PopupMenuItem('Скопировать адрес');
            copy.connect('activate', () => this._copy(url));
            item.menu.addMenuItem(copy);
            const open = new PopupMenu.PopupMenuItem('Открыть в браузере');
            open.connect('activate', () => Gio.AppInfo.launch_default_for_uri(url, null));
            item.menu.addMenuItem(open);
        }
        if (port !== null) {
            const close = new PopupMenu.PopupMenuItem('Закрыть порт');
            close.connect('activate', () => this._command(['share', 'stop', String(port)]));
            item.menu.addMenuItem(close);
        }
        return item;
    }

    _portItem() {
        const hint = 'Порты без входа: 5173 3000';
        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const entry = new St.Entry({
            style_class: 'ah-port-entry',
            hint_text: hint,
            can_focus: true,
            x_expand: true,
        });
        entry.clutter_text.connect('activate', () => {
            const ports = entry.get_text().split(/[\s,]+/).filter(Boolean);
            if (!ports.length || !ports.every(port => /^\d+$/.test(port)))
                return;
            entry.set_text('');
            entry.hint_text = `Открываю ${ports.join(', ')}…`;
            let left = ports.length;
            for (const port of ports) {
                run(['share', port], this._cancellable, (address, error) => {
                    if (--left === 0)
                        entry.hint_text = hint;
                    if (error)
                        Main.notify('Agent Hub', `Порт ${port}: ${error}`);
                    else
                        this._copy(address);
                    this.refresh();
                });
            }
            this.refresh();
        });
        item.add_child(entry);
        return item;
    }

    _copy(url) {
        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, url);
        Main.notify('Agent Hub', `Адрес скопирован: ${host(url)}`);
    }

    _command(args) {
        run(args, this._cancellable, (_stdout, error) => {
            if (error)
                Main.notify('Agent Hub', error);
            // A command that failed leaves the status as it was; the switch must still go back to it.
            this._shown = null;
            this.refresh();
        });
    }

    destroy() {
        this._cancellable.cancel();
        if (this._timer) {
            GLib.source_remove(this._timer);
            this._timer = null;
        }
        super.destroy();
    }
});

export default class AgentHubExtension extends Extension {
    enable() {
        this._indicator = new Indicator(GLib.build_filenamev([this.path, 'icons', 'agent-hub-symbolic.svg']));
        Main.panel.addToStatusArea(this.uuid, this._indicator, 0, 'right');
    }

    disable() {
        this._indicator?.destroy();
        this._indicator = null;
    }
}
