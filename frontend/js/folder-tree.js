const FolderTree = {
  props: {
    nodes: { type: Array, default: () => [] },
    selected: { type: String, default: null },
    contextMenu: { type: Boolean, default: false },
    countField: { type: String, default: "count" },
  },
  emits: ["select", "contextmenu"],
  template: `
    <q-tree class="folder-tree" :nodes="nodes" node-key="path" label-key="label"
            dense no-connectors @keydown.stop @keypress.capture="onFolderKeypress"
            :selected="selected" @update:selected="$emit('select', $event)"
            :expanded="expanded" @update:expanded="expanded = $event">
      <template v-slot:default-header="prop">
        <div class="folder-tree-entry">
          <button v-if="prop.node.children && prop.node.children.length" type="button"
                  class="folder-tree-disclosure" :aria-expanded="prop.expanded"
                  :aria-label="disclosureLabel(prop.node, prop.expanded)"
                  @click.stop="prop.expanded = !prop.expanded" @keydown.stop @keypress.stop>
            <svg viewBox="0 0 20 20" aria-hidden="true" :class="{ 'is-expanded': prop.expanded }">
              <path d="m7.5 4.5 5.5 5.5-5.5 5.5" />
            </svg>
          </button>
          <span v-else class="folder-tree-disclosure-spacer" aria-hidden="true" @click.stop></span>
          <div class="folder-tree-item" :data-path="prop.node.path"
               @contextmenu.prevent="contextMenu && $emit('contextmenu', $event, prop.node)">
            <svg class="folder-tree-icon" viewBox="0 0 24 24" aria-hidden="true"
                 :data-state="prop.expanded ? 'open' : 'closed'">
              <template v-if="prop.expanded">
                <path d="M3 19V5.5A1.5 1.5 0 0 1 4.5 4H9l2 3h7.5A1.5 1.5 0 0 1 20 8.5V10" />
                <path d="M3 19l3.5-8H22l-3.5 9H4a1 1 0 0 1-1-1Z" />
              </template>
              <path v-else d="M3 18.5v-13A1.5 1.5 0 0 1 4.5 4H9l2 3h8.5A1.5 1.5 0 0 1 21 8.5v10a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 18.5Z" />
            </svg>
            <span class="folder-tree-label">{{ prop.node.label }}</span>
            <span class="folder-tree-count">{{ prop.node[countField] || '' }}</span>
            <q-tooltip :delay="1000" v-if="prop.node.label && prop.node.label.length > 10">{{ prop.node.label }}</q-tooltip>
          </div>
        </div>
      </template>
    </q-tree>
  `,
  data() {
    return { expanded: [] };
  },
  methods: {
    disclosureLabel(node, expanded) {
      return t(expanded ? 'side.collapse_folder' : 'side.expand_folder', { name: node.label });
    },
    onFolderKeypress(event) {
      // Quasar normally expands on Space; folder focus selects, disclosure focus expands.
      if (event.key !== ' ' && event.key !== 'Spacebar') return;
      if (event.target.closest('.folder-tree-disclosure')) return;
      const header = event.target.closest('.q-tree__node-header');
      const item = header?.querySelector('.folder-tree-item');
      if (!item) return;
      event.preventDefault();
      event.stopPropagation();
      this.$emit('select', this.selected === item.dataset.path ? null : item.dataset.path);
    },
  },
};
