const FolderTree = {
  props: {
    nodes: { type: Array, default: () => [] },
    selected: { type: String, default: null },
    contextMenu: { type: Boolean, default: false },
    countField: { type: String, default: "count" },
  },
  emits: ["select", "contextmenu"],
  template: `
    <q-tree :nodes="nodes" node-key="path" label-key="label"
            dense no-connectors
            :selected="selected" @update:selected="$emit('select', $event)"
            :expanded="expanded" @update:expanded="expanded = $event">
      <template v-slot:default-header="prop">
        <div style="display:flex;align-items:center;gap:4px;overflow:hidden;width:100%"
             @contextmenu.prevent="contextMenu && $emit('contextmenu', $event, prop.node)">
          <q-icon name="folder" size="16px" :color="selected===prop.node.path ? 'primary' : 'grey-6'" class="q-mr-xs"></q-icon>
          <span style="font-size:12px;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ prop.node.label }}</span>
          <span style="font-size:10px;color:var(--text3);margin-left:auto;flex-shrink:0">{{ prop.node[countField] || '' }}</span>
          <q-tooltip :delay="1000" v-if="prop.node.label && prop.node.label.length > 10">{{ prop.node.label }}</q-tooltip>
        </div>
      </template>
    </q-tree>
  `,
  data() {
    return { expanded: [] };
  },
  watch: {
  },
};
