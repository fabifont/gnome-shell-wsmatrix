import Gio from 'gi://Gio';
import Gettext from 'gettext';

const GROUP_AXES = ['none', 'row', 'column'];

// Workspace names live in GNOME's shared org.gnome.desktop.wm.preferences
// workspace-names list, so a name set here is the one the rest of the shell
// shows as well. An empty entry means the workspace uses its default name.
//
// Optionally, the rows or the columns of the grid form named groups of
// workspaces; their names are stored in this extension's settings.
export default class WorkspaceNames {
    constructor(settings) {
        this._settings = settings;
        this._wmPrefs = new Gio.Settings({
            schema_id: 'org.gnome.desktop.wm.preferences',
        });
    }

    destroy() {
        this._wmPrefs = null;
        this._settings = null;
    }

    // The default name GNOME gives an unnamed workspace, in the user's
    // language (the same string Meta.prefs_get_workspace_name falls back to).
    defaultWorkspaceName(index) {
        return Gettext.dgettext('mutter', 'Workspace %d').replace('%d', String(index + 1));
    }

    // The custom name stored for a workspace, or '' if it has none.
    customWorkspaceName(index) {
        const names = this._wmPrefs.get_strv('workspace-names');
        return index < names.length ? names[index] : '';
    }

    // The name to display for a workspace.
    workspaceName(index) {
        return this.customWorkspaceName(index) || this.defaultWorkspaceName(index);
    }

    connectChanged(callback) {
        return this._wmPrefs.connect('changed::workspace-names', callback);
    }

    disconnect(id) {
        this._wmPrefs.disconnect(id);
    }

    // 'none', 'row' or 'column'.
    groupAxis() {
        return GROUP_AXES[this._settings.get_enum('group-axis')];
    }

    groupsEnabled() {
        return this.groupAxis() !== 'none';
    }

    groupCount() {
        const wsm = global.workspace_manager;
        return this.groupAxis() === 'row' ? wsm.layout_rows : wsm.layout_columns;
    }

    groupIndexOf(index) {
        const columns = global.workspace_manager.layout_columns;
        return this.groupAxis() === 'row' ? Math.floor(index / columns) : index % columns;
    }

    _groupNamesKey(axis = this.groupAxis()) {
        return axis === 'row' ? 'group-names-row' : 'group-names-column';
    }

    // The custom name of a group, or '' if it has none.
    customGroupName(groupIndex, axis = this.groupAxis()) {
        const names = this._settings.get_strv(this._groupNamesKey(axis));
        return groupIndex < names.length ? names[groupIndex] : '';
    }

    // The name to display for a group: its custom name or its number.
    groupName(groupIndex, axis = this.groupAxis()) {
        return this.customGroupName(groupIndex, axis) || String(groupIndex + 1);
    }

    // The axis is passed explicitly by callers that started an edit before a
    // possible change of the axis setting.
    setGroupName(groupIndex, text, axis = this.groupAxis()) {
        const key = this._groupNamesKey(axis);
        const names = this._settings.get_strv(key);
        while (names.length <= groupIndex)
            names.push('');

        text = text.trim();
        if (text === String(groupIndex + 1))
            text = '';

        names[groupIndex] = text;
        this._settings.set_strv(key, names);
    }

    connectGroupsChanged(callback) {
        return ['group-axis', 'group-names-row', 'group-names-column'].map(key =>
            this._settings.connect(`changed::${key}`, callback));
    }

    disconnectGroups(ids) {
        ids.forEach(id => this._settings.disconnect(id));
    }

    setWorkspaceName(index, text) {
        const names = this._wmPrefs.get_strv('workspace-names');
        while (names.length <= index)
            names.push('');

        // An empty name, or the default name typed back in, clears the custom
        // name instead of storing the default as a literal.
        text = text.trim();
        if (text === this.defaultWorkspaceName(index))
            text = '';

        names[index] = text;
        this._wmPrefs.set_strv('workspace-names', names);
    }
}
