import Atk from 'gi://Atk';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import {SCROLL_TIMEOUT_TIME} from 'resource:///org/gnome/shell/ui/windowManager.js';
import WorkspaceNames from '../workspaceNames.js';

const POSITIONS = ['left', 'center', 'right'];

const IndicatorButton = GObject.registerClass(
class IndicatorButton extends PanelMenu.Button {
    _init(callbacks) {
        // No menu: a click opens the workspace overview instead.
        super._init(0.0, null, true);
        this.accessible_role = Atk.Role.PUSH_BUTTON;
        this._callbacks = callbacks;

        this._canScroll = true;
        this._scrollTimeoutId = 0;
        this.connect('destroy', () => {
            if (this._scrollTimeoutId) {
                GLib.source_remove(this._scrollTimeoutId);
                this._scrollTimeoutId = 0;
            }
        });

        this._label = new St.Label({
            y_align: Clutter.ActorAlign.CENTER,
            style_class: 'wsmatrix-indicator-label',
        });
        this.add_child(this._label);

        this.connect('button-press-event', this._onButtonPress.bind(this));
        this.connect('scroll-event', this._onScroll.bind(this));
    }

    setText(text) {
        this._label.text = text;
        this.accessible_name = text;
    }

    _toggleOverview() {
        this._callbacks.toggleOverview();
        return Clutter.EVENT_STOP;
    }

    _onButtonPress(actor, event) {
        if (event.get_button() !== Clutter.BUTTON_PRIMARY)
            return Clutter.EVENT_PROPAGATE;

        return this._toggleOverview();
    }

    _onScroll(actor, event) {
        if (!this._canScroll)
            return Clutter.EVENT_STOP;

        let direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.SMOOTH) {
            const [dx, dy] = event.get_scroll_delta();
            if (dx === 0 && dy === 0)
                return Clutter.EVENT_PROPAGATE;
            if (Math.abs(dy) >= Math.abs(dx))
                direction = dy < 0 ? Clutter.ScrollDirection.UP : Clutter.ScrollDirection.DOWN;
            else
                direction = dx < 0 ? Clutter.ScrollDirection.LEFT : Clutter.ScrollDirection.RIGHT;
        }

        const motion = {
            [Clutter.ScrollDirection.UP]: Meta.MotionDirection.UP,
            [Clutter.ScrollDirection.DOWN]: Meta.MotionDirection.DOWN,
            [Clutter.ScrollDirection.LEFT]: Meta.MotionDirection.LEFT,
            [Clutter.ScrollDirection.RIGHT]: Meta.MotionDirection.RIGHT,
        }[direction];
        if (motion === undefined)
            return Clutter.EVENT_PROPAGATE;

        this._callbacks.scroll(motion);

        // Rate-limit like the shell's own workspace scrolling, so one flick of
        // a touchpad does not skip several workspaces.
        this._canScroll = false;
        this._scrollTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, SCROLL_TIMEOUT_TIME, () => {
            this._canScroll = true;
            this._scrollTimeoutId = 0;
            return GLib.SOURCE_REMOVE;
        });

        return Clutter.EVENT_STOP;
    }
});

// Enter and Space open the overview when the item has keyboard focus, like
// the Activities button.
const bindingPool = IndicatorButton.get_binding_pool();
for (const key of [Clutter.KEY_Return, Clutter.KEY_KP_Enter, Clutter.KEY_space]) {
    bindingPool.install_closure('toggle-overview', key, Clutter.RELEASE_MASK,
        button => button._toggleOverview());
}

// Shows the name of the active workspace, prefixed with its group when
// workspace groups are enabled, in the top bar. A click opens the workspace
// overview, scrolling switches workspaces.
export default class WorkspaceIndicator {
    constructor(settings, callbacks) {
        this._settings = settings;
        this._callbacks = callbacks;
        this._names = new WorkspaceNames(settings);
        this._button = null;
        this._settingsSignals = [];
        this._wsmSignals = [];
    }

    enable() {
        this._settingsSignals.push(this._settings.connect(
            'changed::show-panel-indicator', this._sync.bind(this)));
        this._settingsSignals.push(this._settings.connect(
            'changed::panel-indicator-position', this._replace.bind(this)));
        this._namesSignal = this._names.connectChanged(this._update.bind(this));
        this._groupsSignals = this._names.connectGroupsChanged(this._update.bind(this));

        this._sync();
    }

    disable() {
        this._settingsSignals.forEach(id => this._settings.disconnect(id));
        this._settingsSignals = [];
        this._names.disconnect(this._namesSignal);
        this._names.disconnectGroups(this._groupsSignals);
        this._hide();
        this._names.destroy();
        this._names = null;
    }

    _sync() {
        if (this._settings.get_boolean('show-panel-indicator'))
            this._show();
        else
            this._hide();
    }

    _show() {
        if (this._button)
            return;

        this._button = new IndicatorButton(this._callbacks);

        // Right after Activities on the left, first in the center or right box.
        const box = POSITIONS[this._settings.get_enum('panel-indicator-position')];
        Main.panel.addToStatusArea('wsmatrix-indicator', this._button, box === 'left' ? 1 : 0, box);

        const wsm = global.workspace_manager;
        // A different grid layout can put the active workspace in another
        // group without switching workspaces.
        ['active-workspace-changed', 'workspaces-reordered',
            'notify::layout-rows', 'notify::layout-columns'].forEach(signal =>
            this._wsmSignals.push(wsm.connect(signal, this._update.bind(this))));

        this._update();
    }

    _hide() {
        this._wsmSignals.forEach(id => global.workspace_manager.disconnect(id));
        this._wsmSignals = [];
        this._button?.destroy();
        this._button = null;
    }

    _replace() {
        if (!this._button)
            return;
        this._hide();
        this._show();
    }

    _update() {
        if (!this._button)
            return;

        const index = global.workspace_manager.get_active_workspace_index();
        let text = this._names.workspaceName(index);
        if (this._names.groupsEnabled())
            text = `${this._names.groupName(this._names.groupIndexOf(index))} / ${text}`;
        this._button.setText(text);
    }
}
