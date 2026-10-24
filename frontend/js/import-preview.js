// Keep the existing card layout while rendering only the visible rows.
const ImportPreview = {
  props: { items: { type: Array, required: true }, importing: Boolean },
  emits: ['open'],
  data() { return { width: 600 }; },
  computed: {
    columns() { return Math.max(1, Math.floor((this.width + 8) / 108)); },
    rows() {
      const rows = [];
      for (let i = 0; i < this.items.length; i += this.columns) rows.push(this.items.slice(i, i + this.columns));
      return rows;
    },
    rowHeight() { return (this.width - (this.columns - 1) * 8) / this.columns * 9 / 16 + (this.importing ? 33 : 51); },
  },
  watch: {
    'items.length'() {
      if (this.importing) this.$nextTick(() => this.$refs.list?.scrollTo(this.rows.length - 1, 'end'));
    },
  },
  mounted() {
    this._resize = new ResizeObserver(entries => { this.width = entries[0].contentRect.width; });
    this._resize.observe(this.$el);
  },
  beforeUnmount() { this._resize.disconnect(); },
  methods: { thumbUrl: id => API.thumbUrl(id), fmtSize },
  template: `
    <q-virtual-scroll ref="list" class="import-preview-list" :items="rows"
      :virtual-scroll-item-size="rowHeight" :virtual-scroll-slice-size="12"
      style="max-height:268px;overflow-y:auto" tabindex="0">
      <template v-slot="{ item: row, index }">
        <div class="import-preview-grid" :style="{ gridTemplateColumns: 'repeat(' + columns + ', minmax(0, 1fr))', paddingBottom: '8px' }">
          <div v-for="(item, column) in row" :key="item.id" class="import-preview-card"
            :style="{ cursor: importing ? 'default' : 'pointer' }" :data-id="item.id"
            :role="importing ? 'listitem' : 'button'" :tabindex="importing ? null : 0"
            :aria-label="item.file_name" :aria-posinset="index * columns + column + 1" :aria-setsize="items.length"
            @click="!importing && $emit('open', item.id)"
            @keydown.enter.prevent="!importing && $emit('open', item.id)">
            <div class="import-preview-thumb">
              <img v-if="item.thumbnail_path" :src="thumbUrl(item.id)" loading="lazy" decoding="async" alt="">
              <div v-else class="import-preview-placeholder">
                <q-icon :name="item.media_type === 'video' ? 'movie' : item.media_type === 'audio' ? 'music_note' : 'image'" size="24px" color="grey-6"></q-icon>
              </div>
            </div>
            <div class="import-preview-name">{{ item.file_name }}</div>
            <div class="import-preview-meta" v-if="!importing && item.width">{{ item.width }}x{{ item.height }} &middot; {{ fmtSize(item.file_size) }}</div>
          </div>
        </div>
      </template>
    </q-virtual-scroll>`,
};
