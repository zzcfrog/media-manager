const GalleryPage = {
  template: `
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
    <!-- Filter bar: type, fav/analyzed, stars, colors, reset, search, sort, group, view -->
    <div class="filter-bar">
      <q-btn-group unelevated style="border-radius:6px;overflow:hidden">
        <q-btn unelevated dense size="sm" label="ALL"
               :style="filters.media_type==='all'?'background:var(--accent) !important;color:#fff !important':''"
               @click="filters.media_type='all'; load()">
          <q-tooltip :delay="1000">{{ t('g.all') }}</q-tooltip>
        </q-btn>
        <q-btn unelevated dense size="sm" icon="image"
               :style="filters.media_type==='image'?'background:var(--accent) !important;color:#fff !important':''"
               @click="filters.media_type='image'; load()">
          <q-tooltip :delay="1000">{{ t('g.images') }}</q-tooltip>
        </q-btn>
        <q-btn unelevated dense size="sm" icon="smart_display"
               :style="filters.media_type==='video'?'background:var(--accent) !important;color:#fff !important':''"
               @click="filters.media_type='video'; load()">
          <q-tooltip :delay="1000">{{ t('g.videos') }}</q-tooltip>
        </q-btn>
      </q-btn-group>
      <div style="display:flex;gap:2px">
        <q-btn flat round dense size="sm" @click="cycleFavFilter(); showFilterToast(); load()"
               :class="favFilter === 'unfav' ? 'filter-icon-off' : ''">
          <q-icon v-if="favFilter === 'fav'" name="favorite" color="red" size="18px"></q-icon>
          <q-icon v-else-if="favFilter === 'unfav'" name="favorite_border" color="grey-7" size="18px" style="opacity:0.5"></q-icon>
          <q-icon v-else name="favorite_border" color="grey-7" size="18px"></q-icon>
          <q-tooltip :delay="1000">{{ favFilter === 'fav' ? t('g.fav_only') : favFilter === 'unfav' ? t('g.unfav_only') : t('g.fav_filter') }}</q-tooltip>
        </q-btn>
        <q-btn flat round dense size="sm" @click="cycleAnalysisFilter(); showFilterToast(); load()"
               :class="analysisFilter === 'not' ? 'filter-icon-off' : ''">
          <q-icon name="auto_awesome" :color="analysisFilter === 'analyzed' ? 'primary' : 'grey-7'" size="18px"
                  :style="analysisFilter === 'not' ? 'opacity:0.5' : ''"></q-icon>
          <q-tooltip :delay="1000">{{ analysisFilter === 'analyzed' ? t('g.analyzed_only') : analysisFilter === 'not' ? t('g.not_analyzed_only') : t('g.analysis_filter') }}</q-tooltip>
        </q-btn>
      </div>
      <div class="filter-stars">
        <span v-for="n in 5" :key="n" class="star-btn" :class="{lit: filters.rating && n <= filters.rating}" @click="toggleRating(n)">★</span>
      </div>
      <div class="filter-colors">
        <span v-for="c in colorOptions" :key="c.value" class="color-swatch" :class="['bg-'+c.value, {active: filters.color_label===c.value, dim: filters.color_label && filters.color_label!==c.value}]" @click="toggleColor(c.value)"></span>
      </div>
      <q-input v-model="searchText" dense filled :placeholder="t('g.search_placeholder')"
               color="grey-5" style="width:220px" @keyup.enter="doSearch">
        <template v-slot:append>
          <q-icon v-if="searchText" name="close" size="14px" color="grey-6" style="cursor:pointer" @click="searchText=''; doSearch()"></q-icon>
          <q-btn flat round dense icon="search" size="xs" color="grey-6" @click="doSearch"></q-btn>
        </template>
      </q-input>
      <q-btn v-if="hasFilters" flat round dense icon="filter_list_off" size="sm" color="grey-6" @click="resetFilters">
        <q-tooltip :delay="1000">{{ t('g.reset_filter') }}</q-tooltip>
      </q-btn>
      <div class="spacer"></div>
      <div class="sort-group">
        <q-select v-model="sortBy" dense filled options-dense
          :options="sortOptions" emit-value map-options
          @update:model-value="load"></q-select>
        <q-btn flat dense :icon="sortOrder==='desc' ? 'arrow_downward' : 'arrow_upward'"
               color="grey-6" size="sm" @click="sortOrder=sortOrder==='desc'?'asc':'desc'; load()"></q-btn>
      </div>
      <q-select v-if="isTimeSort" v-model="groupBy" dense filled options-dense
        :options="timeGroupOptions" emit-value map-options
        style="min-width:100px" class="q-ml-xs"></q-select>
      <q-select v-if="sortBy==='duration'" v-model="groupBy" dense filled options-dense
        :options="durGroupOptions" emit-value map-options
        style="min-width:100px" class="q-ml-xs"></q-select>
      <q-btn-group flat style="flex-shrink:0">
        <q-btn flat dense icon="apps" size="md" @click="viewMode='grid'" :style="{color: viewMode==='grid' ? 'var(--accent)' : 'var(--text3)'}">
          <q-tooltip :delay="1000">{{ t('g.grid_view') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense icon="view_column" size="md" @click="viewMode='masonry'" :style="{color: viewMode==='masonry' ? 'var(--accent)' : 'var(--text3)'}">
          <q-tooltip :delay="1000">{{ t('g.masonry_view') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense size="md" @click="viewMode='justified'" :style="{color: viewMode==='justified' ? 'var(--accent)' : 'var(--text3)'}">
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor"><rect x="1" y="3" width="18" height="4"/><rect x="1" y="8" width="18" height="4"/><rect x="1" y="13" width="18" height="4"/></svg>
          <q-tooltip :delay="1000">{{ t('g.justified_view') }}</q-tooltip>
        </q-btn>
        <q-btn flat dense icon="list" size="md" @click="viewMode='list'" :style="{color: viewMode==='list' ? 'var(--accent)' : 'var(--text3)'}">
          <q-tooltip :delay="1000">{{ t('g.list_view') }}</q-tooltip>
        </q-btn>
      </q-btn-group>
    </div>
    <!-- Main gallery area with grid/list views and lasso selection -->
    <div ref="galleryPage" class="gallery-page" @mousedown="startLasso" @contextmenu.prevent>
      <!-- Grid view: grouped with timeline -->
      <template v-if="items.length && viewMode==='grid' && groupedItems">
        <q-timeline color="primary" layout="dense" style="padding-left:8px">
          <q-timeline-entry v-for="g in groupedItems" :key="g.key"
            :title="t('g.timeline_label', {label: g.label, n: g.items.length})"
            tag="div" class="timeline-group">
            <div class="grid" :style="{'--card-w': (180*gridScale)+'px'}">
            <div class="media-card" v-for="m in g.items" :key="m.id"
                 :class="{selected: selArr.includes(m.id)}"
                 :data-id="m.id"
                 @mousedown.stop
                 @click="onCardClick(m, $event)"
                 @dblclick="openDetail(m.id)"
                 @contextmenu.prevent="showCtx($event, m)">
              <div v-if="selArr.includes(m.id)" class="sel-overlay"></div>
              <div v-if="$root.pickerMode" class="picker-check"><q-icon v-if="selArr.includes(m.id)" name="check" size="14px" color="white"></q-icon></div>
              <div class="thumb-wrap">
                <img class="thumb" :src="API.thumbUrl(m.id)" loading="lazy" @load="onThumbLoad" @error="$event.target.src='/static/img/no-thumb.svg'">
                <span class="type-badge"><q-icon :name="m.media_type==='video' ? 'play_arrow' : 'image'" size="12px" color="white"></q-icon></span>
                <span v-if="m.favorite" class="fav-badge"><q-icon name="favorite" size="12px" color="red"></q-icon></span>
                <span v-if="m.color_label" class="color-dot" :class="'color-' + m.color_label"></span>
                <span v-if="m.analysis_status==='done'" class="ai-badge"><q-icon name="auto_awesome" size="10px" color="white"></q-icon></span>
                <span v-if="m.has_xmp && m.media_type==='image'" class="xmp-badge" style="color:white;font-size:7px;font-weight:700">XMP</span>
              </div>
              <div v-if="m.rating" class="rating">{{ '★'.repeat(m.rating) }}</div>
              <div class="info">
                <div class="name" :title="m.file_name">{{ m.file_name }}</div>
                <div class="meta">
                  <span v-if="m.width">{{ m.width }}x{{ m.height }}</span>
                  <span v-if="m.camera_model">{{ m.camera_model }}</span>
                  <span class="spacer"></span>
                  <span v-if="m.duration" class="dur-inline">{{ fmtDur(m.duration) }}</span>
                </div>
              </div>
            </div>
          </div>
        </q-timeline-entry>
        </q-timeline>
      </template>
      <!-- Grid view: flat -->
      <div v-if="items.length && viewMode==='grid' && !groupedItems" class="grid" :style="{'--card-w': (180*gridScale)+'px'}">
        <div class="media-card" v-for="m in items" :key="m.id"
             :class="{selected: selArr.includes(m.id)}"
             :data-id="m.id"
             @mousedown.stop
             @click="onCardClick(m, $event)"
             @dblclick="openDetail(m.id)"
             @contextmenu.prevent="showCtx($event, m)">
          <div v-if="selArr.includes(m.id)" class="sel-overlay"></div>
              <div v-if="$root.pickerMode" class="picker-check"><q-icon v-if="selArr.includes(m.id)" name="check" size="14px" color="white"></q-icon></div>
          <div class="thumb-wrap">
            <img class="thumb" :src="API.thumbUrl(m.id)" loading="lazy" @load="onThumbLoad" @error="$event.target.src='/static/img/no-thumb.svg'">
            <span class="type-badge"><q-icon :name="m.media_type==='video' ? 'play_arrow' : 'image'" size="12px" color="white"></q-icon></span>
            <span v-if="m.favorite" class="fav-badge"><q-icon name="favorite" size="12px" color="red"></q-icon></span>
            <span v-if="m.color_label" class="color-dot" :class="'color-' + m.color_label"></span>
            <span v-if="m.analysis_status==='done'" class="ai-badge"><q-icon name="auto_awesome" size="10px" color="white"></q-icon></span>
            <span v-if="m.has_xmp && m.media_type==='image'" class="xmp-badge" style="color:white;font-size:7px;font-weight:700">XMP</span>
          </div>
          <div v-if="m.rating" class="rating">{{ '★'.repeat(m.rating) }}</div>
          <div class="info">
            <div class="name" :title="m.file_name">{{ m.file_name }}</div>
            <div class="meta">
              <span v-if="m.width">{{ m.width }}x{{ m.height }}</span>
              <span v-if="m.camera_model">{{ m.camera_model }}</span>
              <span class="spacer"></span>
              <span v-if="m.duration" class="dur-inline">{{ fmtDur(m.duration) }}</span>
            </div>
          </div>
        </div>
      </div>
      <!-- Masonry view: grouped with timeline -->
      <template v-if="items.length && viewMode==='masonry' && groupedItems">
        <q-timeline color="primary" layout="dense" style="padding-left:8px">
          <q-timeline-entry v-for="g in groupedItems" :key="g.key"
            :title="t('g.timeline_label', {label: g.label, n: g.items.length})"
            tag="div" class="timeline-group">
            <div class="masonry" :style="{'--masonry-cols': masonryCols}">
            <div class="masonry-card" v-for="m in g.items" :key="m.id"
                 :class="{selected: selArr.includes(m.id)}"
                 :data-id="m.id"
                 @mousedown.stop
                 @click="onCardClick(m, $event)"
                 @dblclick="openDetail(m.id)"
                 @contextmenu.prevent="showCtx($event, m)">
              <div v-if="selArr.includes(m.id)" class="sel-overlay"></div>
              <div v-if="$root.pickerMode" class="picker-check"><q-icon v-if="selArr.includes(m.id)" name="check" size="14px" color="white"></q-icon></div>
              <div class="masonry-img">
                <img :src="API.thumbUrl(m.id)" loading="lazy" @load="onThumbLoad" @error="$event.target.src='/static/img/no-thumb.svg'">
                <span class="type-badge"><q-icon :name="m.media_type==='video' ? 'play_arrow' : 'image'" size="12px" color="white"></q-icon></span>
                <span v-if="m.favorite" class="fav-badge"><q-icon name="favorite" size="12px" color="red"></q-icon></span>
                <span v-if="m.color_label" class="color-dot" :class="'color-' + m.color_label"></span>
                <span v-if="m.analysis_status==='done'" class="ai-badge"><q-icon name="auto_awesome" size="10px" color="white"></q-icon></span>
                <span v-if="m.has_xmp && m.media_type==='image'" class="xmp-badge" style="color:white;font-size:7px;font-weight:700">XMP</span>
              </div>
              <div v-if="m.rating" class="rating">{{ '★'.repeat(m.rating) }}</div>
              <div class="masonry-info">
                <span class="masonry-name" :title="m.file_name">{{ m.file_name }}</span>
                <span class="masonry-size">{{ fmtSize(m.file_size) }}</span>
              </div>
            </div>
          </div>
        </q-timeline-entry>
        </q-timeline>
      </template>
      <!-- Masonry view: flat -->
      <div v-if="items.length && viewMode==='masonry' && !groupedItems" class="masonry" :style="{'--masonry-cols': masonryCols}">
        <div class="masonry-card" v-for="m in items" :key="m.id"
             :class="{selected: selArr.includes(m.id)}"
             :data-id="m.id"
             @mousedown.stop
             @click="onCardClick(m, $event)"
             @dblclick="openDetail(m.id)"
             @contextmenu.prevent="showCtx($event, m)">
          <div v-if="selArr.includes(m.id)" class="sel-overlay"></div>
              <div v-if="$root.pickerMode" class="picker-check"><q-icon v-if="selArr.includes(m.id)" name="check" size="14px" color="white"></q-icon></div>
          <div class="masonry-img">
            <img :src="API.thumbUrl(m.id)" loading="lazy" @load="onThumbLoad" @error="$event.target.src='/static/img/no-thumb.svg'">
            <span class="type-badge"><q-icon :name="m.media_type==='video' ? 'play_arrow' : 'image'" size="12px" color="white"></q-icon></span>
            <span v-if="m.favorite" class="fav-badge"><q-icon name="favorite" size="12px" color="red"></q-icon></span>
            <span v-if="m.color_label" class="color-dot" :class="'color-' + m.color_label"></span>
            <span v-if="m.analysis_status==='done'" class="ai-badge"><q-icon name="auto_awesome" size="10px" color="white"></q-icon></span>
            <span v-if="m.has_xmp && m.media_type==='image'" class="xmp-badge" style="color:white;font-size:7px;font-weight:700">XMP</span>
          </div>
          <div v-if="m.rating" class="rating">{{ '★'.repeat(m.rating) }}</div>
          <div class="masonry-info">
            <span class="masonry-name" :title="m.file_name">{{ m.file_name }}</span>
            <span class="masonry-size">{{ fmtSize(m.file_size) }}</span>
          </div>
        </div>
      </div>
      <!-- Justified view: grouped with timeline -->
      <template v-if="items.length && viewMode==='justified' && groupedItems">
        <q-timeline color="primary" layout="dense" style="padding-left:8px">
          <q-timeline-entry v-for="g in groupedItems" :key="g.key"
            :title="t('g.timeline_label', {label: g.label, n: g.items.length})"
            tag="div" class="timeline-group">
            <div v-for="(row, ri) in layoutJustified(g.items)" :key="ri" class="justified-row">
              <div v-for="m in row.items" :key="m.id" class="justified-card"
                   :style="{width: m._jw + 'px', height: row.height + 'px'}"
                   :class="{selected: selArr.includes(m.id)}"
                   :data-id="m.id"
                   @click="onCardClick(m, $event)"
                   @dblclick="openDetail(m.id)"
                   @contextmenu.prevent="showCtx($event, m)">
                <div v-if="selArr.includes(m.id)" class="sel-overlay"></div>
              <div v-if="$root.pickerMode" class="picker-check"><q-icon v-if="selArr.includes(m.id)" name="check" size="14px" color="white"></q-icon></div>
                <img :src="API.thumbUrl(m.id)" loading="lazy" @load="onThumbLoad" @error="$event.target.src='/static/img/no-thumb.svg'">
                <span class="type-badge"><q-icon :name="m.media_type==='video' ? 'play_arrow' : 'image'" size="12px" color="white"></q-icon></span>
                <span v-if="m.favorite" class="fav-badge"><q-icon name="favorite" size="12px" color="red"></q-icon></span>
                <span v-if="m.color_label" class="color-dot" :class="'color-' + m.color_label"></span>
                <span v-if="m.analysis_status==='done'" class="ai-badge"><q-icon name="auto_awesome" size="10px" color="white"></q-icon></span>
                <span v-if="m.has_xmp && m.media_type==='image'" class="xmp-badge" style="color:white;font-size:7px;font-weight:700">XMP</span>
                <div v-if="m.rating" class="rating">{{ '★'.repeat(m.rating) }}</div>
                <div class="justified-info">
                  <span class="justified-name">{{ m.file_name }}</span>
                  <span class="justified-size">{{ fmtSize(m.file_size) }}</span>
                </div>
              </div>
            </div>
          </q-timeline-entry>
        </q-timeline>
      </template>
      <!-- Justified view: flat -->
      <template v-if="items.length && viewMode==='justified' && !groupedItems">
        <div v-for="(row, ri) in layoutJustified(items)" :key="ri" class="justified-row">
          <div v-for="m in row.items" :key="m.id" class="justified-card"
               :style="{width: m._jw + 'px', height: row.height + 'px'}"
               :class="{selected: selArr.includes(m.id)}"
               :data-id="m.id"
               @click="onCardClick(m, $event)"
               @dblclick="openDetail(m.id)"
               @contextmenu.prevent="showCtx($event, m)">
            <div v-if="selArr.includes(m.id)" class="sel-overlay"></div>
              <div v-if="$root.pickerMode" class="picker-check"><q-icon v-if="selArr.includes(m.id)" name="check" size="14px" color="white"></q-icon></div>
            <img :src="API.thumbUrl(m.id)" loading="lazy" @load="onThumbLoad" @error="$event.target.src='/static/img/no-thumb.svg'">
            <span class="type-badge"><q-icon :name="m.media_type==='video' ? 'play_arrow' : 'image'" size="12px" color="white"></q-icon></span>
            <span v-if="m.favorite" class="fav-badge"><q-icon name="favorite" size="12px" color="red"></q-icon></span>
            <span v-if="m.color_label" class="color-dot" :class="'color-' + m.color_label"></span>
            <span v-if="m.analysis_status==='done'" class="ai-badge"><q-icon name="auto_awesome" size="10px" color="white"></q-icon></span>
            <span v-if="m.has_xmp && m.media_type==='image'" class="xmp-badge" style="color:white;font-size:7px;font-weight:700">XMP</span>
            <div v-if="m.rating" class="rating">{{ '★'.repeat(m.rating) }}</div>
            <div class="justified-info">
              <span class="justified-name">{{ m.file_name }}</span>
              <span class="justified-size">{{ fmtSize(m.file_size) }}</span>
            </div>
          </div>
        </div>
      </template>
                  <!-- List view: grouped with timeline -->
      <template v-if="items.length && viewMode==='list' && groupedItems">
        <q-timeline color="primary" layout="dense" style="padding-left:8px">
          <q-timeline-entry v-for="g in groupedItems" :key="g.key"
            :title="t('g.timeline_label', {label: g.label, n: g.items.length})"
            tag="div" class="timeline-group">
            <div class="list">
            <div class="media-row" v-for="m in g.items" :key="m.id"
                 :class="{selected: selArr.includes(m.id)}"
                 :data-id="m.id"
                 @click="onCardClick(m, $event)"
                 @dblclick="openDetail(m.id)"
                 @contextmenu.prevent="showCtx($event, m)">
              <div class="row-thumb-wrap">
                <img class="row-thumb" :src="API.thumbUrl(m.id)" loading="lazy" @error="$event.target.src='/static/img/no-thumb.svg'">
                <span class="type-badge"><q-icon :name="m.media_type==='video' ? 'play_arrow' : 'image'" size="12px" color="white"></q-icon></span>
              </div>
              <div class="row-name" :title="m.file_name">{{ m.file_name }}</div>
              <span class="row-col">{{ m.width ? m.width+'x'+m.height : '-' }}</span>
              <span class="row-col">{{ m.duration ? fmtDur(m.duration) : '-' }}</span>
              <span class="row-col">{{ fmtSize(m.file_size) }}</span>
              <span class="row-col">{{ fmtListDate(m.date_taken) }}</span>
              <span class="row-col">{{ fmtListDate(m.imported_at) }}</span>
              <span class="row-col">
                <span v-if="m.rating" class="row-stars">{{ '★'.repeat(m.rating) }}</span>
                <span v-if="m.favorite" class="row-fav"><q-icon name="favorite" size="12px" color="red"></q-icon></span>
                <span v-if="m.color_label" class="color-dot" :class="'color-' + m.color_label"></span>
                <span v-if="m.analysis_status==='done'" class="row-ai"><q-icon name="auto_awesome" size="12px" color="var(--accent)"></q-icon></span>
              </span>
              <span style="width:32px"></span>
            </div>
          </div>
        </q-timeline-entry>
        </q-timeline>
      </template>
      <!-- List view: flat -->
      <div v-if="items.length && viewMode==='list' && !groupedItems" class="list">
        <div class="list-header">
          <span style="width:72px"></span>
          <span class="lh-name lh-sort" @click="toggleSort('file_name')">{{ t('g.col_filename') }} <span v-if="sortBy==='file_name'">{{ sortOrder==='desc'?'↓':'↑' }}</span></span>
          <span class="lh-col lh-sort" @click="toggleSort('resolution')">{{ t('g.col_resolution') }} <span v-if="sortBy==='resolution'">{{ sortOrder==='desc'?'↓':'↑' }}</span></span>
          <span class="lh-col lh-sort" @click="toggleSort('duration')">{{ t('g.col_duration') }} <span v-if="sortBy==='duration'">{{ sortOrder==='desc'?'↓':'↑' }}</span></span>
          <span class="lh-col lh-sort" @click="toggleSort('file_size')">{{ t('g.col_size') }} <span v-if="sortBy==='file_size'">{{ sortOrder==='desc'?'↓':'↑' }}</span></span>
          <span class="lh-col lh-sort" @click="toggleSort('date_taken')">{{ t('g.col_date_taken') }} <span v-if="sortBy==='date_taken'">{{ sortOrder==='desc'?'↓':'↑' }}</span></span>
          <span class="lh-col lh-sort" @click="toggleSort('imported_at')">{{ t('g.col_imported_at') }} <span v-if="sortBy==='imported_at'">{{ sortOrder==='desc'?'↓':'↑' }}</span></span>
          <span class="lh-col lh-sort" style="width:110px" @click="toggleSort('rating')">{{ t('g.col_rating') }} <span v-if="sortBy==='rating'">{{ sortOrder==='desc'?'↓':'↑' }}</span></span>
          <span style="width:32px"></span>
        </div>
        <div class="media-row" v-for="m in items" :key="m.id"
             :class="{selected: selArr.includes(m.id)}"
             :data-id="m.id"
             @click="onCardClick(m, $event)"
             @dblclick="openDetail(m.id)"
             @contextmenu.prevent="showCtx($event, m)">
          <div class="row-thumb-wrap">
            <img class="row-thumb" :src="API.thumbUrl(m.id)" loading="lazy" @error="$event.target.src='/static/img/no-thumb.svg'">
            <span class="type-badge"><q-icon :name="m.media_type==='video' ? 'play_arrow' : 'image'" size="12px" color="white"></q-icon></span>
          </div>
          <div class="row-name" :title="m.file_name">{{ m.file_name }}</div>
          <span class="row-col">{{ m.width ? m.width+'x'+m.height : '-' }}</span>
          <span class="row-col">{{ m.duration ? fmtDur(m.duration) : '-' }}</span>
          <span class="row-col">{{ fmtSize(m.file_size) }}</span>
          <span class="row-col">{{ fmtListDate(m.date_taken) }}</span>
          <span class="row-col">{{ fmtListDate(m.imported_at) }}</span>
          <span class="row-col" style="width:110px;overflow:visible">
            <span v-if="m.rating" class="row-stars">{{ '★'.repeat(m.rating) }}</span>
            <span v-if="m.color_label" class="color-dot" :class="'color-' + m.color_label"></span>
            <span v-if="m.favorite" class="row-fav"><q-icon name="favorite" size="12px" color="red"></q-icon></span>
            <span v-if="m.analysis_status==='done'" class="row-ai"><q-icon name="auto_awesome" size="12px" color="var(--accent)"></q-icon></span>
          </span>
          <span style="width:32px"></span>
        </div>
      </div>
      <div v-if="!items.length && !loading" class="empty">
        <q-icon name="folder_open" size="40px" color="grey-7"></q-icon>
        <p>{{ t('g.empty') }}</p>
      </div>
      <div ref="sentinel" style="height:1px;width:100%"></div>
      <div v-if="loadingMore" class="load-more-spinner">
        <q-spinner-dots color="grey-6" size="28px"></q-spinner-dots>
      </div>
    </div>
    <q-toolbar class="gallery-footer" style="border-top:1px solid var(--border);min-height:36px;flex-shrink:0;position:relative">
      <span class="text-caption" style="color:var(--text3)">{{ t('g.total', {n: total}) }}
        <span v-if="selArr.length" style="color:var(--accent)" class="q-ml-sm">{{ t('g.selected', {n: selArr.length}) }}</span>
      </span>
      <div v-if="activeFilterTags.length" class="header-tags" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%)">
        <span v-for="(tag, i) in activeFilterTags" :key="i" class="header-tag">
          <span v-if="tag.icon" :class="tag.off ? 'filter-icon-off' : ''" style="position:relative;display:inline-flex;align-items:center"><q-icon :name="tag.icon" size="12px"></q-icon></span>
          <span v-if="tag.stars">{{ tag.stars }}</span>
          <span v-if="tag.dot" class="header-tag-dot" :class="'bg-'+tag.dot"></span>
          <span v-if="tag.label">{{ tag.label }}</span>
        </span>
      </div>
      <q-space></q-space>
      <template v-if="viewMode==='grid'">
        <span class="text-caption q-mr-sm" style="color:var(--text3)">{{ Math.round(gridScale*100) }}%</span>
        <q-slider v-model="gridScale" :min="0.5" :max="2" :step="0.25"
                  style="width:100px;--q-primary:var(--accent)" color="primary"></q-slider>
      </template>
      <template v-if="viewMode==='masonry'">
        <span class="text-caption q-mr-sm" style="color:var(--text3)">{{ t('g.masonry_cols', {n: masonryCols}) }}</span>
        <q-slider v-model="masonryCols" :min="3" :max="8" :step="1"
                  style="width:100px;--q-primary:var(--accent)" color="primary"></q-slider>
      </template>
      <template v-if="viewMode==='justified'">
        <span class="text-caption q-mr-sm" style="color:var(--text3)">{{ t('g.row_height', {n: justifiedRowH}) }}</span>
        <q-slider v-model="justifiedRowH" :min="120" :max="400" :step="10"
                  style="width:100px;--q-primary:var(--accent)" color="primary"></q-slider>
      </template>
    </q-toolbar>
    <!-- Context menu: view detail, remove, find similar -->
    <div v-if="ctxMenu.show" class="ctx-menu-popup" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
      <q-list dense style="min-width:200px;border-radius:8px;overflow:hidden">
        <q-item clickable @click="ctxMenu.show = false; openDetail(selArr[0])" :disable="selArr.length > 1" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="visibility" size="14px" color="grey-6"></q-icon></q-item-section>
          <q-item-section>{{ t('g.ctx_view_detail') }}</q-item-section>
          <q-item-section side style="flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:var(--text3)">↵</span></q-item-section>
        </q-item>
        <q-item clickable @click="ctxMenu.show = false; revealCtx()" :disable="selArr.length !== 1" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="folder_open" size="14px" color="grey-6"></q-icon></q-item-section>
          <q-item-section>{{ t('g.ctx_reveal') }}</q-item-section>
        </q-item>
        <q-separator style="background:var(--border)"></q-separator>
        <q-item v-if="selArr.length === 1 && ctxMenu.item && ctxMenu.item.media_type !== 'video'" clickable @click="ctxMenu.show = false; findSimilar()" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="content_copy" size="14px" color="grey-6"></q-icon></q-item-section>
          <q-item-section>{{ t('g.ctx_find_similar') }}</q-item-section>
        </q-item>
        <q-item clickable @click="openBatchAnalysisDialog()" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="auto_awesome" size="14px" color="grey-6"></q-icon></q-item-section>
          <q-item-section>{{ selArr.length > 1 ? t('g.ctx_analyze_n', {n: selArr.length}) : t('g.ctx_analyze') }}</q-item-section>
        </q-item>
        <q-separator style="background:var(--border)"></q-separator>
        <q-item clickable @click="ctxMenu.show = false; deleteCtx()" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="delete_outline" size="14px" color="negative"></q-icon></q-item-section>
          <q-item-section style="color:var(--negative)">{{ selArr.length > 1 ? t('g.ctx_remove_n', {n: selArr.length}) : t('g.ctx_remove') }}</q-item-section>
          <q-item-section side style="flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:var(--text3)">⌘+⌫</span></q-item-section>
        </q-item>
      </q-list>
    </div>
    <!-- Delete confirm -->
    <q-dialog v-model="confirmDelete.show">
      <q-card style="min-width:360px" class="dialog-card">
        <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" v-close-popup></q-btn>
        <q-card-section>
          <div class="text-h6">{{ t('g.confirm_remove') }}</div>
        </q-card-section>
        <q-card-section>
          <p class="text-body2">{{ t('g.confirm_remove_msg', {name: confirmDelete.name}) }}</p>
          <p class="text-caption text-grey-6">{{ t('g.remove_note') }}</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="t('g.cancel')" @click="confirmDelete.show=false"></q-btn>
          <q-btn color="red" :label="t('g.confirm_remove')" @click="doDelete"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
    <!-- Batch delete confirm -->
    <q-dialog v-model="confirmBatch.show">
      <q-card style="min-width:360px" class="dialog-card">
        <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" v-close-popup></q-btn>
        <q-card-section>
          <div class="text-h6">{{ t('g.batch_remove') }}</div>
        </q-card-section>
        <q-card-section>
          <p class="text-body2">{{ t('g.batch_remove_msg', {n: selArr.length}) }}</p>
          <p class="text-caption text-grey-6">{{ t('g.remove_note') }}</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="t('g.cancel')" @click="confirmBatch.show=false"></q-btn>
          <q-btn color="red" :label="t('g.confirm_remove')" @click="doBatchDelete"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
    <!-- Batch AI Analysis confirm -->
    <q-dialog v-model="showBatchAnalysisDialog" class="batch-analysis-dialog">
      <q-card style="min-width:400px" class="dialog-card">
        <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" v-close-popup></q-btn>
        <q-card-section>
          <div class="text-h6">{{ t('g.batch_analysis_title') }}</div>
        </q-card-section>
        <q-card-section style="padding-top:0">
          <!-- Stats -->
          <div style="display:flex;gap:16px;margin-bottom:16px">
            <div style="flex:1;text-align:center;padding:12px 8px;border-radius:8px;background:var(--surface2)">
              <div style="font-size:20px;font-weight:700;color:var(--accent)">{{ batchAnalysisInfo.videos + batchAnalysisInfo.images }}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">{{ t('g.batch_total', {n: ''}) }}</div>
            </div>
            <div style="flex:1;text-align:center;padding:12px 8px;border-radius:8px;background:var(--surface2)">
              <div style="font-size:20px;font-weight:700;color:var(--accent)">{{ batchAnalysisInfo.videos }}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">{{ t('g.batch_videos', {n: ''}) }}</div>
            </div>
            <div style="flex:1;text-align:center;padding:12px 8px;border-radius:8px;background:var(--surface2)">
              <div style="font-size:20px;font-weight:700;color:var(--accent)">{{ batchAnalysisInfo.images }}</div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">{{ t('g.batch_images', {n: ''}) }}</div>
            </div>
          </div>
          <!-- Models -->
          <div style="font-size:13px;display:flex;flex-direction:column;gap:6px">
            <div v-if="batchAnalysisInfo.videos > 0" style="display:flex;justify-content:space-between"><span style="color:var(--text3)">{{ t('g.batch_video_model') }}</span><span>{{ batchAnalysisInfo.videoModel }}</span></div>
            <div v-if="batchAnalysisInfo.images > 0" style="display:flex;justify-content:space-between"><span style="color:var(--text3)">{{ t('g.batch_image_model') }}</span><span>{{ batchAnalysisInfo.imageModel }}</span></div>
          </div>
          <!-- Already analyzed -->
          <div v-if="batchAnalysisInfo.analyzedCount > 0" style="margin-top:14px;padding:10px 14px;border-radius:8px;background:var(--surface2)">
            <div style="font-size:12px;color:var(--text3);margin-bottom:8px">{{ t('g.batch_already_analyzed', {n: batchAnalysisInfo.analyzedCount}) }}</div>
            <div style="display:flex;gap:16px">
              <q-radio v-model="batchAnalysisInfo.existingAction" val="reanalyze" dense :label="t('g.batch_reanalyze')" color="primary" style="font-size:13px"></q-radio>
              <q-radio v-model="batchAnalysisInfo.existingAction" val="skip" dense :label="t('g.batch_skip')" color="primary" style="font-size:13px"></q-radio>
            </div>
          </div>
          <!-- Cost warning -->
          <div style="margin-top:14px;padding:8px 12px;border-radius:6px;background:var(--surface2);font-size:12px;color:var(--text3);display:flex;align-items:center;gap:6px">
            <q-icon name="info" size="14px" color="grey-6"></q-icon>
            {{ t('d.ai_cost_warning') }}
          </div>
        </q-card-section>
        <q-card-actions align="right" style="padding:8px 16px 16px">
          <q-btn flat :label="t('g.cancel')" v-close-popup></q-btn>
          <q-btn color="primary" :label="t('g.start_analysis')" @click="confirmBatchAnalysis()"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
    <!-- Find Similar Modal -->
    <q-dialog v-model="similarDlg.show" persistent transition-show="scale" transition-hide="scale">
      <q-card class="dialog-card" style="width:93vw;max-width:1400px;height:92vh;display:flex;flex-direction:column">
        <div style="display:flex;align-items:center;gap:12px;padding:10px 16px;border-bottom:1px solid var(--border)">
          <img :src="'/media/thumbnail/' + similarDlg.source?.id" style="width:40px;height:40px;object-fit:cover;border-radius:6px">
          <div style="min-width:0">
            <div style="font-size:13px;font-weight:600">{{ t('g.find_similar') }}</div>
            <div style="font-size:11px;color:var(--text3);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ similarDlg.source?.file_name }}</div>
          </div>
          <div style="flex:1"></div>
          <q-btn-group unelevated class="sort-group" style="border-radius:6px;overflow:hidden;border:none;background:var(--surface2)">
            <q-btn unelevated dense :color="similarDlg.similarType==='near'?'primary':'grey-9'" :text-color="similarDlg.similarType==='near'?'white':'grey-6'" icon="filter_none" :label="t('dup.near')" @click="switchSimilarType('near')" style="padding:3px 10px;min-height:28px;font-size:13px">
              <q-tooltip :delay="1000">{{ t('dup.near_tip') }}</q-tooltip>
            </q-btn>
            <q-btn unelevated dense :color="similarDlg.similarType==='similar'?'primary':'grey-9'" :text-color="similarDlg.similarType==='similar'?'white':'grey-6'" icon="difference" :label="t('dup.similar')" @click="switchSimilarType('similar')" style="padding:3px 10px;min-height:28px;font-size:13px">
              <q-tooltip :delay="1000">{{ t('dup.similar_tip') }}</q-tooltip>
            </q-btn>
            <q-btn unelevated dense :color="similarDlg.similarType==='cluster'?'primary':'grey-9'" :text-color="similarDlg.similarType==='cluster'?'white':'grey-6'" icon="bubble_chart" :label="t('dup.cluster')" @click="switchSimilarType('cluster')" style="padding:3px 10px;min-height:28px;font-size:13px">
              <q-tooltip :delay="1000">{{ t('dup.cluster_tip') }}</q-tooltip>
            </q-btn>
          </q-btn-group>
          <q-btn flat round dense icon="close" size="sm" color="grey-6" v-close-popup style="margin-left:8px"></q-btn>
        </div>
        <div v-if="similarDlg.loading" style="flex:1;display:flex;align-items:center;justify-content:center">
          <q-spinner-dots color="grey-6" size="40px"></q-spinner-dots>
        </div>
        <div v-else-if="!currentSimilarItems.length" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text3);gap:8px">
          <q-icon name="check_circle" size="36px" style="opacity:0.3"></q-icon>
          <span>{{ t('g.no_similar_found', {type: similarTypeLabel}) }}</span>
        </div>
        <q-scroll-area v-else style="flex:1">
          <div style="padding:16px 20px;display:flex;flex-wrap:wrap;gap:10px">
            <div v-for="item in currentSimilarItems" :key="item.id"
                 class="dup-card"
                 @dblclick.stop="closeSimilarModal(); $root.openDetail(item.id)"
                 @contextmenu.prevent="showSimilarCtx($event, item)">
              <div class="dup-card-img">
                <img :src="'/media/thumbnail/' + item.id" draggable="false" @load="onThumbLoad">
                <button class="dup-exclude-btn" :title="t('g.exclude')" @click.stop="openSimilarExcludeDialog(item)">✕</button>
              </div>
              <div class="dup-card-info">
                <span class="dup-card-name" :title="item.file_name">{{ item.file_name }}</span>
                <span v-if="item.similarity != null" style="font-size:10px;color:var(--accent);flex-shrink:0">{{ (item.similarity * 100).toFixed(0) }}%</span>
                <span class="dup-card-size">{{ fmtSize(item.file_size) }}</span>
              </div>
              <q-tooltip :delay="800" :offset="[0, 4]">{{ item.file_path }}</q-tooltip>
            </div>
          </div>
        </q-scroll-area>
        <div style="flex-shrink:0;padding:6px 20px;font-size:12px;color:var(--text3);border-top:1px solid var(--border);text-align:center">
          {{ t('g.found_similar', {n: currentSimilarItems.length, type: similarTypeLabel}) }}
        </div>
        <!-- Similar item context menu -->
        <div v-if="similarCtxMenu.show" class="ctx-menu-popup" :style="{ left: similarCtxMenu.x + 'px', top: similarCtxMenu.y + 'px' }" @mousedown.stop>
          <q-list dense style="min-width:200px;border-radius:8px;overflow:hidden">
            <q-item clickable @click="closeSimilarCtx(); closeSimilarModal(); $root.openDetail(similarCtxMenu.item.id)" style="padding-left:8px;padding-right:12px">
              <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="visibility" size="14px" color="grey-6"></q-icon></q-item-section>
              <q-item-section>{{ t('g.ctx_view_detail') }}</q-item-section>
            </q-item>
            <q-item clickable @click="closeSimilarCtx(); API.revealFile(similarCtxMenu.item.id)" style="padding-left:8px;padding-right:12px">
              <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="folder_open" size="14px" color="grey-6"></q-icon></q-item-section>
              <q-item-section>{{ t('g.ctx_reveal') }}</q-item-section>
            </q-item>
            <q-separator style="background:var(--border)"></q-separator>
            <q-item clickable @click="closeSimilarCtx(); openSimilarExcludeDialog(similarCtxMenu.item)" style="padding-left:8px;padding-right:12px">
              <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="group_remove" size="14px" color="grey-6"></q-icon></q-item-section>
              <q-item-section>{{ t('g.remove_from_group', {type: similarTypeLabel}) }}</q-item-section>
            </q-item>
            <q-item clickable @click="closeSimilarCtx(); similarDeleteConfirm = { show: true, id: similarCtxMenu.item.id, name: similarCtxMenu.item.file_name }" style="padding-left:8px;padding-right:12px">
              <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="delete_outline" size="14px" color="negative"></q-icon></q-item-section>
              <q-item-section style="color:var(--negative)">{{ t('g.ctx_remove') }}</q-item-section>
            </q-item>
          </q-list>
        </div>
        <!-- Similar exclude dialog -->
        <q-dialog v-model="similarExcludeDlg.show" persistent>
          <q-card style="min-width:520px;max-width:640px" class="dialog-card">
            <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" @click="similarExcludeDlg.show=false"></q-btn>
            <q-card-section>
              <div class="text-h6" style="font-size:16px">{{ t('g.remove_from_group', {type: similarTypeLabel}) }}</div>
              <div style="font-size:12px;color:var(--text3);margin-top:4px">{{ t('g.exclude_desc') }}</div>
            </q-card-section>
            <q-card-section>
              <div style="display:flex;gap:16px;align-items:flex-start">
                <div style="flex-shrink:0;text-align:center">
                  <img :src="'/media/thumbnail/' + similarExcludeDlg.item?.id"
                       style="width:140px;height:140px;object-fit:cover;border-radius:8px;border:2px solid var(--accent)">
                  <div style="margin-top:6px;font-size:11px;color:var(--text2);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ similarExcludeDlg.item?.file_name }}</div>
                  <div style="font-size:10px;color:var(--text3)">{{ t('g.current_photo') }}</div>
                </div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                    <span style="font-size:12px;color:var(--text2)">{{ t('g.which_not_similar') }}<span style="color:var(--text3);margin-left:4px">{{ t('g.total_photos', {n: similarExcludeDlg.candidates.length}) }}</span></span>
                    <q-btn flat dense size="sm" :label="similarExcludeDlg.candidates.every(c => c.selected) ? t('g.deselect_all') : t('g.select_all')" color="primary" no-caps @click="similarExcludeSelectAll" style="font-size:12px"></q-btn>
                  </div>
                  <div class="exclude-scroll-wrap">
                    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;padding:4px">
                      <div v-for="c in similarExcludeDlg.candidates" :key="c.item.id"
                           style="cursor:pointer;border-radius:6px;overflow:hidden;border:2px solid transparent;transition:border-color .15s"
                           :style="c.selected ? 'border-color:var(--negative)' : 'border-color:var(--border)'"
                           @click="c.selected = !c.selected">
                        <img :src="'/media/thumbnail/' + c.item.id" style="width:100%;aspect-ratio:1;object-fit:cover;display:block">
                        <div style="font-size:10px;color:var(--text3);padding:2px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.item.file_name }}</div>
                      </div>
                    </div>
                    <div v-if="similarExcludeDlg.candidates.length > 6" class="exclude-scroll-hint">{{ t('g.scroll_down_more') }}</div>
                  </div>
                </div>
              </div>
            </q-card-section>
            <q-card-actions align="right" style="padding:12px 16px">
              <q-btn flat :label="t('g.cancel')" @click="similarExcludeDlg.show=false"></q-btn>
              <q-btn color="primary" :label="t('g.exclude_n', {n: similarExcludeSelectedCount})" :disable="similarExcludeSelectedCount === 0" @click="doSimilarExclude"></q-btn>
            </q-card-actions>
          </q-card>
        </q-dialog>
        <!-- Similar delete confirm -->
        <q-dialog v-model="similarDeleteConfirm.show">
          <q-card style="min-width:360px" class="dialog-card">
            <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" v-close-popup></q-btn>
            <q-card-section>
              <div class="text-h6">{{ t('g.confirm_remove_library') }}</div>
            </q-card-section>
            <q-card-section>
              <p class="text-body2">{{ t('g.confirm_remove_msg', {name: similarDeleteConfirm.name}) }}</p>
              <p class="text-caption text-grey-6">{{ t('g.remove_note') }}</p>
            </q-card-section>
            <q-card-actions align="right">
              <q-btn flat :label="t('g.cancel')" @click="similarDeleteConfirm.show=false"></q-btn>
              <q-btn color="red" :label="t('g.ctx_remove')" @click="doSimilarDelete"></q-btn>
            </q-card-actions>
          </q-card>
        </q-dialog>
      </q-card>
    </q-dialog>
    <!-- Lasso overlay -->
    <div v-if="lasso" class="lasso" :style="lassoStyle"></div>
  </div>
  `,
  // -- Data: state, filters, sort/group options --
  data() {
    return {
      items: [], total: 0, page: 1, perPage: 60, loading: false, loadingMore: false, allLoaded: false, viewMode: "grid", searchText: "",
      sortBy: "imported_at", sortOrder: "desc", gridScale: 1, masonryCols: 5, justifiedRowH: 220,
      selArr: [], lasso: null, lastClickIdx: -1,
      ctxMenu: { show: false, item: null, x: 0, y: 0 },
      confirmDelete: { show: false, id: null, name: "" },
      confirmBatch: { show: false },
      showBatchAnalysisDialog: false,
      batchAnalysisInfo: { videos: 0, images: 0, analyzedCount: 0, videoModel: '', imageModel: '', existingAction: 'reanalyze' },
      similarDlg: { show: false, source: null, loading: false, similarType: 'near', near: [], similar: [], cluster: [] },
      similarCtxMenu: { show: false, item: null, x: 0, y: 0 },
      similarExcludeDlg: { show: false, item: null, candidates: [] },
      similarDeleteConfirm: { show: false, id: null, name: "" },
      filters: { media_type: "all", rating: "", color_label: "" },
      favFilter: null,       // null → 'fav' → 'unfav' → null
      analysisFilter: null,  // null → 'analyzed' → 'not' → null
      groupBy: "",
      colorOptions: [
        { value: "red" }, { value: "yellow" }, { value: "green" }, { value: "blue" }, { value: "purple" },
      ],
    };
  },
  watch: {
    sortBy(val) {
      const isTime = val === "imported_at" || val === "date_taken";
      const isDur = val === "duration";
      if (!isTime && !isDur) this.groupBy = "";
      else if (val !== this._prevSortBy) this.groupBy = "";
      this._prevSortBy = val;
    },
    selArr: {
      handler(val) {
        if (this.$root.pickerMode) this.$root.pickerSelected = [...val];
      },
      deep: true,
    },
  },
  computed: {
    sortOptions() {
      return [
        { label: this.t('g.sort_imported_at'), value: "imported_at" },
        { label: this.t('g.sort_date_taken'), value: "date_taken" },
        { label: this.t('g.sort_file_name'), value: "file_name" },
        { label: this.t('g.sort_resolution'), value: "resolution" },
        { label: this.t('g.sort_duration'), value: "duration" },
        { label: this.t('g.sort_file_size'), value: "file_size" },
        { label: this.t('g.sort_rating'), value: "rating" },
      ];
    },
    timeGroupOptions() {
      return [
        { label: this.t('g.group_none'), value: "" },
        { label: this.t('g.group_day'), value: "day" },
        { label: this.t('g.group_week'), value: "week" },
        { label: this.t('g.group_month'), value: "month" },
        { label: this.t('g.group_quarter'), value: "quarter" },
        { label: this.t('g.group_year'), value: "year" },
      ];
    },
    durGroupOptions() {
      return [
        { label: this.t('g.group_none'), value: "" },
        { label: this.t('g.group_by_duration'), value: "dur_seg" },
      ];
    },
    similarTypeLabel() {
      return this.t('dup.' + this.similarDlg.similarType);
    },
    currentSimilarItems() {
      return this.similarDlg[this.similarDlg.similarType] || [];
    },
    similarExcludeSelectedCount() {
      return this.similarExcludeDlg.candidates.filter(c => c.selected).length;
    },
    hasFilters() {
      return this.filters.media_type !== "all" || this.filters.rating || this.filters.color_label || this.favFilter || this.analysisFilter || this.searchText;
    },
    activeFilterTags() {
      const tags = [];
      const folder = this.$root.selectedFolder;
      if (folder) {
        const parts = folder.split('/');
        tags.push({ icon: 'folder', label: parts[parts.length - 1] || folder });
      }
      if (this.filters.media_type !== "all") {
        tags.push({ icon: this.filters.media_type === 'image' ? 'image' : 'smart_display', label: this.t(this.filters.media_type === 'image' ? 'g.images' : 'g.videos') });
      }
      if (this.filters.rating) tags.push({ stars: '★'.repeat(this.filters.rating) });
      if (this.filters.color_label) tags.push({ dot: this.filters.color_label });
      if (this.favFilter === 'fav') tags.push({ icon: 'favorite', label: this.t('g.filter_fav') });
      else if (this.favFilter === 'unfav') tags.push({ icon: 'favorite_border', label: this.t('g.filter_unfav'), off: true });
      if (this.analysisFilter === 'analyzed') tags.push({ icon: 'auto_awesome', label: this.t('g.filter_analyzed') });
      else if (this.analysisFilter === 'not') tags.push({ icon: 'auto_awesome', label: this.t('g.filter_not_analyzed'), off: true });
      if (this.searchText) tags.push({ icon: 'search', label: this.searchText });
      return tags;
    },
    isTimeSort() {
      return this.sortBy === "imported_at" || this.sortBy === "date_taken";
    },
    timeField() {
      return this.isTimeSort ? this.sortBy : "";
    },
    groupedItems() {
      if (!this.groupBy) return null;
      const groups = [];
      let current = null;
      if (this.groupBy === "dur_seg") {
        for (const m of this.items) {
          const key = this.getDurKey(m.duration);
          if (!current || current.key !== key) {
            current = { key, label: key, items: [] };
            groups.push(current);
          }
          current.items.push(m);
        }
      } else {
        if (!this.timeField) return null;
        for (const m of this.items) {
          const raw = m[this.timeField];
          const key = this.getGroupKey(raw, this.groupBy);
          if (!current || current.key !== key) {
            current = { key, label: this.fmtGroupLabel(key, this.groupBy), items: [] };
            groups.push(current);
          }
          current.items.push(m);
        }
      }
      return groups;
    },
    lassoStyle() {
      if (!this.lasso) return {};
      return {
        left: Math.min(this.lasso.sx, this.lasso.ex) + "px",
        top: Math.min(this.lasso.sy, this.lasso.ey) + "px",
        width: Math.abs(this.lasso.ex - this.lasso.sx) + "px",
        height: Math.abs(this.lasso.ey - this.lasso.sy) + "px",
      };
    },
  },
  // -- Lifecycle: load data, register keyboard & scroll observers --
  created() {
    const isPicker = this.$root.pickerMode;
    // Restore filters from localStorage (picker uses defaults)
    if (!isPicker) {
      try {
        const saved = JSON.parse(localStorage.getItem('galleryFilters'));
        if (saved) {
          if (saved.filters) Object.assign(this.filters, saved.filters);
          if (saved.favFilter) this.favFilter = saved.favFilter;
          if (saved.analysisFilter) this.analysisFilter = saved.analysisFilter;
          if (saved.sortBy) this.sortBy = saved.sortBy;
          if (saved.sortOrder) this.sortOrder = saved.sortOrder;
          if (saved.groupBy) this.groupBy = saved.groupBy;
          if (saved.viewMode) this.viewMode = saved.viewMode;
          if (saved.gridScale) this.gridScale = saved.gridScale;
          if (saved.masonryCols) this.masonryCols = saved.masonryCols;
          if (saved.justifiedRowH) this.justifiedRowH = saved.justifiedRowH;
          if (saved.searchText) this.searchText = saved.searchText;
        }
      } catch {}
    }
    // Auto-save filters on changes (picker doesn't persist)
    if (!isPicker) {
      this._saveFilters = () => {
        try {
          localStorage.setItem('galleryFilters', JSON.stringify({
            filters: this.filters, favFilter: this.favFilter, analysisFilter: this.analysisFilter,
            sortBy: this.sortBy, sortOrder: this.sortOrder, groupBy: this.groupBy,
            viewMode: this.viewMode, gridScale: this.gridScale,
            masonryCols: this.masonryCols, justifiedRowH: this.justifiedRowH,
            searchText: this.searchText,
          }));
        } catch {}
      };
    } else {
      this._saveFilters = () => {};
    }
    if (!isPicker && this.searchText) this.$root.searchQuery = this.searchText.trim();
    // Picker mode: fewer items per page for lighter GPU load
    if (isPicker) this.perPage = 30;
    // Picker mode: restore pre-selected items
    if (this.$root.pickerMode && this.$root.pickerSelected?.length) {
      this.selArr = [...this.$root.pickerSelected];
    }
    this.load();
    document.addEventListener("mousedown", this.closeCtx);
    document.addEventListener("keydown", this.handleKey, true);
    this._closeSimilarCtx = (e) => {
      if (!this.similarCtxMenu.show) return;
      if (e.target.closest(".ctx-menu-popup")) return;
      this.similarCtxMenu.show = false;
    };
    document.addEventListener("mousedown", this._closeSimilarCtx);
  },
  mounted() {
    this._observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) this.loadMore();
    }, { root: this.$refs.galleryPage, rootMargin: "200px" });
    this.$nextTick(() => {
      if (this.$refs.sentinel) this._observer.observe(this.$refs.sentinel);
    });
  },
  beforeUnmount() {
    document.removeEventListener("mousedown", this.closeCtx);
    document.removeEventListener("mousedown", this._closeSimilarCtx);
    document.removeEventListener("keydown", this.handleKey, true);
    if (this._observer) this._observer.disconnect();
  },
  // -- Methods: data loading, selection, keyboard, context menu, formatting --
  methods: {
    t,
    API,
    // Load first page, reset selection
    async load() {
      if (this._saveFilters) this._saveFilters();
      if (!this.$root.pickerMode) this.selArr = [];
      this.page = 1;
      this.allLoaded = false;
      this.loading = true;
      try {
        const params = { page: 1, per_page: this.perPage, sort: this.sortBy, order: this.sortOrder };
        if (this.filters.media_type !== "all") params.media_type = this.filters.media_type;
        if (this.filters.rating) params.rating = this.filters.rating;
        if (this.filters.color_label) params.color_label = this.filters.color_label;
        if (this.favFilter === 'fav') params.favorite = "true";
        else if (this.favFilter === 'unfav') params.favorite = "false";
        if (this.analysisFilter === 'analyzed') params.analysis_status = "analyzed";
        else if (this.analysisFilter === 'not') params.analysis_status = "not_analyzed";
        const q = this.$root.pickerMode ? this.searchText : this.$root.searchQuery;
        if (q) params.q = q;
        const folder = this.$root.pickerMode ? this.$root.pickerFolder : this.$root.selectedFolder;
        if (folder) params.folder = folder;
        const res = await API.getLibrary(params);
        const data = res.data || [];
        this.total = res.pagination?.total || 0;
        if (data.length < this.perPage) this.allLoaded = true;
        this.items = data;
        if (!this.$root.pickerMode) this.$root.galleryItems = data;
      } catch(e) {
        console.error("gallery load error:", e);
      }
      this.loading = false;
    },
    // Infinite scroll: load next page
    async loadMore() {
      if (this.loadingMore || this.allLoaded) return;
      this.loadingMore = true;
      this.page++;
      try {
        const params = { page: this.page, per_page: this.perPage, sort: this.sortBy, order: this.sortOrder };
        if (this.filters.media_type !== "all") params.media_type = this.filters.media_type;
        if (this.filters.rating) params.rating = this.filters.rating;
        if (this.filters.color_label) params.color_label = this.filters.color_label;
        if (this.favFilter === 'fav' || this.$root.favFilter) params.favorite = "true";
        else if (this.favFilter === 'unfav') params.favorite = "false";
        if (this.analysisFilter === 'analyzed') params.analysis_status = "analyzed";
        else if (this.analysisFilter === 'not') params.analysis_status = "not_analyzed";
        const q = this.$root.pickerMode ? this.searchText : this.$root.searchQuery;
        if (q) params.q = q;
        const folder = this.$root.pickerMode ? this.$root.pickerFolder : this.$root.selectedFolder;
        if (folder) params.folder = folder;
        const res = await API.getLibrary(params);
        const data = res.data || [];
        this.items = this.items.concat(data);
        if (!this.$root.pickerMode) this.$root.galleryItems = this.items;
        this.total = res.pagination?.total || 0;
        if (data.length < this.perPage) this.allLoaded = true;
      } catch(e) {
        console.error("gallery loadMore error:", e);
        this.page--;
      }
      this.loadingMore = false;
    },
    openDetail(id) {
      if (this.$root.pickerMode) return;
      location.hash = `#/detail/${id}`;
    },
    toggleSort(field) {
      if (this.sortBy === field) {
        this.sortOrder = this.sortOrder === "desc" ? "asc" : "desc";
      } else {
        this.sortBy = field;
        this.sortOrder = "desc";
      }
      this.load();
    },
    toggleRating(n) {
      this.filters.rating = this.filters.rating === String(n) ? "" : String(n);
      this.showFilterToast();
      this.load();
    },
    toggleColor(c) {
      this.filters.color_label = this.filters.color_label === c ? "" : c;
      this.showFilterToast();
      this.load();
    },
    cycleFavFilter() {
      this.favFilter = this.favFilter === 'fav' ? 'unfav' : this.favFilter === 'unfav' ? null : 'fav';
    },
    cycleAnalysisFilter() {
      this.analysisFilter = this.analysisFilter === 'analyzed' ? 'not' : this.analysisFilter === 'not' ? null : 'analyzed';
    },
    showFilterToast() {
      const parts = [];
      const typeMap = {image: this.t('g.filter_image'), video: this.t('g.filter_video')};
      if (this.filters.media_type !== "all") parts.push(typeMap[this.filters.media_type]);
      if (this.filters.rating) parts.push(this.t('g.filter_rating', {n: this.filters.rating}));
      if (this.filters.color_label) {
        const cn = {red: this.t('g.color_red'), yellow: this.t('g.color_yellow'), green: this.t('g.color_green'), blue: this.t('g.color_blue'), purple: this.t('g.color_purple')};
        parts.push(cn[this.filters.color_label] + this.t('g.filter_tag_suffix'));
      }
      if (this.favFilter === 'fav') parts.push(this.t('g.filter_fav'));
      else if (this.favFilter === 'unfav') parts.push(this.t('g.filter_unfav'));
      if (this.analysisFilter === 'analyzed') parts.push(this.t('g.filter_analyzed'));
      else if (this.analysisFilter === 'not') parts.push(this.t('g.filter_not_analyzed'));
      const msg = parts.length ? parts.join(" · ") : this.t('g.filter_cleared');
      Quasar.Notify.create({ message: msg, position: 'top', timeout: 1800 });
    },
    doSearch() {
      if (!this.$root.pickerMode) this.$root.searchQuery = this.searchText.trim();
      this.load();
    },
    resetFilters() {
      this.filters.media_type = "all";
      this.filters.rating = null;
      this.filters.color_label = null;
      this.favFilter = null;
      this.analysisFilter = null;
      this.searchText = "";
      if (!this.$root.pickerMode) this.$root.searchQuery = "";
      this.load();
    },
    onCardClick(m, e) {
      const idx = this.items.findIndex(item => item.id === m.id);
      if (this.$root.pickerMode) {
        // Picker mode: toggle on every click
        const arr = [...this.selArr];
        const i = arr.indexOf(m.id);
        if (i >= 0) arr.splice(i, 1); else arr.push(m.id);
        this.selArr = arr;
        this.lastClickIdx = idx;
      } else if (e.shiftKey && this.lastClickIdx >= 0) {
        const from = Math.min(this.lastClickIdx, idx);
        const to = Math.max(this.lastClickIdx, idx);
        const ids = [];
        for (let i = from; i <= to; i++) ids.push(this.items[i].id);
        this.selArr = ids;
      } else if (e.ctrlKey || e.metaKey) {
        const arr = [...this.selArr];
        const i = arr.indexOf(m.id);
        if (i >= 0) arr.splice(i, 1); else arr.push(m.id);
        this.selArr = arr;
        this.lastClickIdx = idx;
      } else {
        this.selArr = [m.id];
        this.lastClickIdx = idx;
      }
    },
    startLasso(e) {
      if (this.viewMode !== "grid" || e.button !== 0) return;
      e.preventDefault();
      const container = this.$refs.galleryPage;
      if (!container) return;
      const sx = e.clientX, sy = e.clientY;
      const startScroll = container.scrollTop;
      let dragging = false;
      let scrollRaf = null;
      const EDGE = 60;
      const SPEED = 12;
      const doScroll = (ev) => {
        const rect = container.getBoundingClientRect();
        let vy = 0;
        if (ev.clientY < rect.top + EDGE) vy = -SPEED;
        else if (ev.clientY > rect.bottom - EDGE) vy = SPEED;
        if (vy) {
          container.scrollTop += vy;
          scrollRaf = requestAnimationFrame(() => doScroll(ev));
        } else if (scrollRaf) {
          cancelAnimationFrame(scrollRaf);
          scrollRaf = null;
        }
      };
      const hitTest = (ev) => {
        const scrollDelta = container.scrollTop - startScroll;
        const syAdj = sy - scrollDelta;
        const x1 = Math.min(sx, ev.clientX), y1 = Math.min(syAdj, ev.clientY);
        const x2 = Math.max(sx, ev.clientX), y2 = Math.max(syAdj, ev.clientY);
        const cards = document.querySelectorAll(".media-card[data-id]");
        const ids = [];
        cards.forEach(el => {
          const r = el.getBoundingClientRect();
          if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) {
            ids.push(parseInt(el.dataset.id));
          }
        });
        this.selArr = ids;
      };
      const onMove = (ev) => {
        ev.preventDefault();
        if (!dragging && (Math.abs(ev.clientX - sx) < 4 && Math.abs(ev.clientY - sy) < 4)) return;
        dragging = true;
        const scrollDelta = container.scrollTop - startScroll;
        const syAdj = sy - scrollDelta;
        this.lasso = { sx, sy: syAdj, ex: ev.clientX, ey: ev.clientY };
        hitTest(ev);
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        doScroll(ev);
      };
      const onUp = () => {
        if (!dragging) this.selArr = [];
        this.lasso = null;
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    },
    showCtx(e, m) {
      if (this.$root.pickerMode) return;
      if (!this.selArr.includes(m.id)) this.selArr = [m.id];
      this.ctxMenu.item = m;
      this.ctxMenu.x = e.clientX;
      this.ctxMenu.y = e.clientY;
      this.ctxMenu.show = true;
    },
    closeCtx(e) {
      if (!this.ctxMenu.show) return;
      if (e.target.closest(".ctx-menu-popup")) return;
      this.ctxMenu.show = false;
    },
    handleKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      // Skip when not on gallery view
      if (this.$root.currentView !== "gallery") return;
      const key = e.key;
      // Arrow keys - move selection
      if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].includes(key)) {
        e.preventDefault(); e.stopPropagation();
        if (!this.items.length) return;
        if (!this.selArr.length) { this.selArr = [this.items[0].id]; return; }
        const lastId = this.selArr[this.selArr.length - 1];
        const idx = this.items.findIndex(m => m.id === lastId);
        let ni = idx;
        if (this.viewMode === "grid") {
          let cols = Math.max(1, Math.floor((this.$refs.galleryPage?.clientWidth || 800) / (180 * this.gridScale)));
          const cards = this.$refs.galleryPage?.querySelectorAll("[data-id]");
          if (cards?.length >= 2) {
            const firstTop = cards[0].getBoundingClientRect().top;
            const secondRow = Array.from(cards).findIndex(c => c.getBoundingClientRect().top > firstTop + 5);
            if (secondRow > 0) cols = secondRow;
          }
          if (key === "ArrowRight") ni = Math.min(idx + 1, this.items.length - 1);
          else if (key === "ArrowLeft") ni = Math.max(idx - 1, 0);
          else if (key === "ArrowDown") ni = Math.min(idx + cols, this.items.length - 1);
          else if (key === "ArrowUp") ni = Math.max(idx - cols, 0);
        } else {
          if (key === "ArrowDown" || key === "ArrowRight") ni = Math.min(idx + 1, this.items.length - 1);
          else ni = Math.max(idx - 1, 0);
        }
        if (ni !== idx) this.selArr = [this.items[ni].id];
        this.$nextTick(() => {
          const el = document.querySelector(`[data-id="${this.items[ni]?.id}"]`);
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
        return;
      }
      // Delete
      if (key === "Delete" || key === "Backspace") {
        if (this.$root.pickerMode || !this.selArr.length) return;
        e.preventDefault(); e.stopPropagation();
        this.deleteCtx();
        return;
      }
      // Enter - open detail (or toggle in picker mode)
      if (key === "Enter" && this.selArr.length === 1) {
        if (this.$root.pickerMode) return;
        e.preventDefault(); e.stopPropagation();
        this.openDetail(this.selArr[0]);
        return;
      }
      // Color label 6-9,0 → red,yellow,green,blue,purple
      const colorKeys = { "6": "red", "7": "yellow", "8": "green", "9": "blue", "0": "purple" };
      if (colorKeys[key] && this.selArr.length) {
        e.preventDefault(); e.stopPropagation();
        const color = colorKeys[key];
        API.batchUpdate({ action: "color_label", value: color, ids: [...this.selArr] }).then(() => {
          this.selArr.forEach(id => { const m = this.items.find(i => i.id === id); if (m) m.color_label = color; });
        });
        return;
      }
      // Rating 1-5 (0 handled above as purple)
      if (key >= "1" && key <= "5" && this.selArr.length) {
        e.preventDefault(); e.stopPropagation();
        API.batchUpdate({ action: "rate", value: parseInt(key), ids: [...this.selArr] }).then(() => {
          this.selArr.forEach(id => { const m = this.items.find(i => i.id === id); if (m) m.rating = parseInt(key); });
        });
        return;
      }
      // L - toggle favorite
      if (key === "l" || key === "L") {
        if (!this.selArr.length) return;
        e.preventDefault(); e.stopPropagation();
        const id = this.selArr[0];
        const m = this.items.find(i => i.id === id);
        if (!m) return;
        const val = m.favorite ? 0 : 1;
        API.batchUpdate({ action: "favorite", value: val, ids: [...this.selArr] }).then(() => {
          this.selArr.forEach(sid => { const sm = this.items.find(i => i.id === sid); if (sm) sm.favorite = val; });
        });
        return;
      }
      // G - toggle grid/list
      if (key === "g" || key === "G") {
        e.preventDefault(); e.stopPropagation();
        this.viewMode = ({ grid: "masonry", masonry: "justified", justified: "list", list: "grid" })[this.viewMode] || "grid";
        return;
      }
      // / - focus search
      if (key === "/") {
        e.preventDefault(); e.stopPropagation();
        const input = this.$el?.querySelector("input");
        if (input) input.focus();
        return;
      }
    },
    clearSelection() {
      this.selArr = [];
    },
    deleteCtx() {
      if (this.selArr.length > 1) {
        this.confirmBatch.show = true;
      } else {
        const id = this.selArr[0];
        const m = this.items.find(i => i.id === id);
        this.confirmDelete = { show: true, id, name: m ? m.file_name : "" };
      }
    },
    async openBatchAnalysisDialog() {
      this.ctxMenu.show = false;
      const s = await API.getSettings();
      const modelLabels = {
        "glm-4v-plus": "智谱 GLM-4V-Plus", "glm-4.6v": "智谱 GLM-4.6V",
        "glm-4.6v-flash": "智谱 GLM-4.6V-Flash", "glm-4.6v-flashx": "智谱 GLM-4.6V-FlashX",
        "glm-4.5v": "智谱 GLM-4.5V",
      };
      const selected = this.items.filter(m => this.selArr.includes(m.id));
      const videos = selected.filter(m => m.media_type === 'video');
      const images = selected.filter(m => m.media_type === 'image');
      const analyzed = selected.filter(m => m.analysis_status === 'done');
      this.batchAnalysisInfo = {
        videos: videos.length,
        images: images.length,
        analyzedCount: analyzed.length,
        videoModel: modelLabels[s.model] || s.model,
        imageModel: modelLabels[s.image_model] || s.image_model,
        existingAction: analyzed.length > 0 ? 'skip' : 'reanalyze',
      };
      this.showBatchAnalysisDialog = true;
    },
    confirmBatchAnalysis() {
      // Save ids and options BEFORE clearing selection
      this._pendingBatchIds = [...this.selArr];
      this._pendingBatchSkipDone = this.batchAnalysisInfo.existingAction === 'skip';

      // Ensure bg-task-bar is in DOM (needed for FLIP target)
      const root = this.$root;
      if (!root.bgTasks.length) {
        root.bgTasks = [{ id: '__placeholder__', status: 'placeholder', percent: 0, fileName: '', mediaType: '', stageLabel: '' }];
      }

      // Capture dialog rect BEFORE closing
      const dialogEl = document.querySelector('.batch-analysis-dialog .q-card');
      const barEl = document.querySelector('.bg-task-bar');
      let dRect = null, bRect = null;
      if (dialogEl) dRect = dialogEl.getBoundingClientRect();
      if (barEl) bRect = barEl.getBoundingClientRect();

      this.showBatchAnalysisDialog = false;

      // FLIP animation after dialog closes
      if (dRect && bRect) {
        const clone = document.createElement('div');
        clone.style.cssText = `position:fixed;left:${dRect.left}px;top:${dRect.top}px;width:${dRect.width}px;height:${dRect.height}px;border-radius:12px;background:var(--surface1);box-shadow:0 8px 32px rgba(0,0,0,0.15);z-index:9999;transition:all 0.45s cubic-bezier(0.4,0,0.2,1);pointer-events:none;`;
        document.body.appendChild(clone);
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            clone.style.left = (bRect.left + bRect.width / 2 - 20) + 'px';
            clone.style.top = bRect.top + 'px';
            clone.style.width = '40px';
            clone.style.height = bRect.height + 'px';
            clone.style.opacity = '0';
            clone.style.borderRadius = '12px';
          });
        });
        setTimeout(() => clone.remove(), 500);
      }

      this.$nextTick(() => this.batchAnalyze());
    },
    async batchAnalyze() {
      const root = this.$root;
      const ids = this._pendingBatchIds || [];
      const skipDone = this._pendingBatchSkipDone;
      this._pendingBatchIds = null;
      this.clearSelection();

      // Remove placeholder if present
      root.bgTasks = root.bgTasks.filter(t => t.id !== '__placeholder__');

      const res = await API.startBatchAnalysis(ids, skipDone);
      const submittedIds = res.submitted || [];

      for (const id of submittedIds) {
        const m = this.items.find(i => i.id === id);
        if (!m) continue;
        const oldIdx = root.bgTasks.findIndex(t => t.id === id);
        if (oldIdx >= 0) root.bgTasks.splice(oldIdx, 1);
        root.bgTasks.push({
          id: m.id, fileName: m.file_name, mediaType: m.media_type,
          status: "running", percent: 0,
          stageLabel: t('g.queued'), startTime: Date.now(),
        });
      }
      root.bgTasks = [...root.bgTasks];

      Quasar.Notify.create({
        message: submittedIds.length > 1
          ? t('g.n_analysis_started', {n: submittedIds.length})
          : t('g.analysis_started'),
        position: "top", timeout: 2000,
      });
    },
    findSimilar() {
      const id = this.selArr[0];
      const m = this.items.find(i => i.id === id);
      if (!m) return;
      this.similarDlg = { show: true, source: m, loading: true, similarType: 'near', near: [], similar: [], cluster: [] };
      API.getSimilar(id).then(res => {
        this.similarDlg.near = res.near || [];
        this.similarDlg.similar = res.similar || [];
        this.similarDlg.cluster = res.cluster || [];
        this.similarDlg.loading = false;
      }).catch(e => {
        Quasar.Notify.create({ message: this.t('g.find_similar_failed', {msg: e.message || e}), position: 'top', color: 'negative', timeout: 2000 });
        this.similarDlg.loading = false;
      });
    },
    switchSimilarType(type) { this.similarDlg.similarType = type; },
    closeSimilarModal() { this.similarDlg.show = false; },
    showSimilarCtx(e, item) {
      this.similarCtxMenu = { show: true, item, x: e.clientX, y: e.clientY };
    },
    closeSimilarCtx() { this.similarCtxMenu.show = false; },
    openSimilarExcludeDialog(item) {
      const sourceId = this.similarDlg.source.id;
      const candidates = this.currentSimilarItems
        .filter(i => i.id !== sourceId)
        .map(i => ({ item: i, selected: i.id === item.id }));
      this.similarExcludeDlg = { show: true, item: this.similarDlg.source, candidates };
    },
    similarExcludeSelectAll() {
      const allSelected = this.similarExcludeDlg.candidates.every(c => c.selected);
      this.similarExcludeDlg.candidates.forEach(c => { c.selected = !allSelected; });
    },
    async doSimilarExclude() {
      const selectedIds = this.similarExcludeDlg.candidates.filter(c => c.selected).map(c => c.item.id);
      if (!selectedIds.length) return;
      const sourceId = this.similarDlg.source.id;
      const pairs = selectedIds.map(id => [sourceId, id]);
      const dupType = this.similarDlg.similarType;
      this.similarExcludeDlg.show = false;
      try {
        await API.addDupExclusions(pairs, dupType);
        const excludeSet = new Set(selectedIds);
        this.similarDlg[dupType] = this.similarDlg[dupType].filter(i => !excludeSet.has(i.id));
        Quasar.Notify.create({ message: this.t('g.excluded_n', {n: selectedIds.length}), position: 'top', timeout: 1500 });
      } catch (e) {
        Quasar.Notify.create({ message: this.t('g.exclude_failed', {msg: e.message || e}), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
    async doSimilarDelete() {
      const id = this.similarDeleteConfirm.id;
      try {
        await API.deleteMedia(id);
        for (const key of ['near', 'similar', 'cluster']) {
          this.similarDlg[key] = this.similarDlg[key].filter(i => i.id !== id);
        }
        this.items = this.items.filter(i => i.id !== id);
        if (!this.$root.pickerMode) this.$root.galleryItems = this.items;
        this.total--;
        Quasar.Notify.create({ message: this.t('g.n_removed', {name: this.similarDeleteConfirm.name}), position: 'top', timeout: 1500 });
      } catch (e) {
        Quasar.Notify.create({ message: this.t('g.remove_failed', {msg: e.message || e}), position: 'top', color: 'negative', timeout: 2000 });
      }
      this.similarDeleteConfirm.show = false;
    },
    revealCtx() {
      API.revealFile(this.selArr[0]);
    },
    async doCtxWriteXmp() {
      const ids = this.selArr.filter(id => {
        const m = this.items.find(i => i.id === id);
        return m && m.media_type === 'image';
      });
      if (!ids.length) {
        Quasar.Notify.create({ message: this.t('g.no_images_to_write'), position: 'top', timeout: 1500 });
        return;
      }
      try {
        const res = await API.batchWriteXmp(ids);
        ids.forEach(id => { const m = this.items.find(i => i.id === id); if (m) m.has_xmp = 1; });
        Quasar.Notify.create({ message: this.t('g.xmp_written', {n: res.count}), position: 'top', timeout: 1500 });
      } catch (e) {
        Quasar.Notify.create({ message: this.t('g.write_failed', {msg: e.message}), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
    async doDelete() {
      try {
        await API.deleteMedia(this.confirmDelete.id);
        this.items = this.items.filter(i => i.id !== this.confirmDelete.id);
        if (!this.$root.pickerMode) this.$root.galleryItems = this.items;
        this.total--;
        Quasar.Notify.create({ message: this.t('g.n_removed', {name: this.confirmDelete.name}), position: 'top', color: 'dark', textColor: 'white', timeout: 1800 });
      } catch (e) {
        console.error("delete error:", e);
      }
      this.selArr = [];
      this.confirmDelete.show = false;
    },
    async doBatchDelete() {
      const ids = [...this.selArr];
      try {
        for (const id of ids) await API.deleteMedia(id);
        const set = new Set(ids);
        this.items = this.items.filter(i => !set.has(i.id));
        if (!this.$root.pickerMode) this.$root.galleryItems = this.items;
        this.total -= ids.length;
        Quasar.Notify.create({ message: this.t('g.n_items_removed', {n: ids.length}), position: 'top', color: 'dark', textColor: 'white', timeout: 1800 });
      } catch (e) { console.error("batch delete error:", e); }
      this.selArr = [];
      this.confirmBatch.show = false;
    },
    fmtDur,
    fmtSize,
    onThumbLoad,
    layoutJustified(items) {
      if (!items.length) return [];
      const page = this.$refs.galleryPage;
      const w = (page ? page.clientWidth : 800) - 16;
      return this._calcRows(items, w, this.justifiedRowH);
    },
    _calcRows(items, containerW, targetH) {
      const gap = 8, rows = [];
      let row = [], rowAspect = 0;
      for (const m of items) {
        const w = m.width || 16, h = m.height || 9;
        const ratio = w / h;
        row.push(Object.assign({}, m, { _ratio: ratio }));
        rowAspect += ratio;
        if (rowAspect * targetH + (row.length - 1) * gap >= containerW && row.length >= 2) {
          const rh = (containerW - (row.length - 1) * gap) / rowAspect;
          const height = Math.round(Math.min(Math.max(rh, 80), targetH * 1.5));
          let usedW = 0;
          row.forEach((m, i) => { m._jw = Math.round(m._ratio * height); usedW += m._jw; });
          row[row.length - 1]._jw += containerW - usedW - (row.length - 1) * gap;
          rows.push({ items: row, height });
          row = []; rowAspect = 0;
        }
      }
      if (row.length) {
        row.forEach(m => { m._jw = Math.round(m._ratio * targetH); });
        rows.push({ items: row, height: targetH });
      }
      return rows;
    },
    fmtListDate(d) {
      if (!d) return "-";
      const dt = new Date(d);
      if (isNaN(dt)) return d;
      const pad = n => n.toString().padStart(2, "0");
      return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())}`;
    },
    getGroupKey(raw, mode) {
      if (!raw) return "unknown";
      const dt = new Date(raw);
      if (isNaN(dt)) return "unknown";
      const y = dt.getFullYear(), m = dt.getMonth() + 1, d = dt.getDate();
      if (mode === "day") return `${y}-${String(m).padStart(2,"0")}-${String(d).padStart(2,"0")}`;
      if (mode === "week") {
        const jan1 = new Date(y, 0, 1);
        const week = Math.ceil(((dt - jan1) / 86400000 + jan1.getDay() + 1) / 7);
        return `${y}-W${String(week).padStart(2,"0")}`;
      }
      if (mode === "month") return `${y}-${String(m).padStart(2,"0")}`;
      if (mode === "quarter") return `${y}-Q${Math.ceil(m / 3)}`;
      if (mode === "year") return `${y}`;
      return "unknown";
    },
    fmtGroupLabel(key, mode) {
      if (key === "unknown") return this.t('g.unknown_date');
      const weekdays = this.t('g.weekdays').split(',');
      if (mode === "day") {
        const dt = new Date(key);
        return key + " " + (isNaN(dt) ? "" : weekdays[dt.getDay()]);
      }
      if (mode === "week") return this.t('g.week_label', {key});
      if (mode === "month") {
        const [y, m] = key.split("-");
        return this.t('g.month_label', {y, m: parseInt(m)});
      }
      if (mode === "quarter") {
        const [y, q] = key.split("-Q");
        return this.t('g.quarter_label', {y, q});
      }
      if (mode === "year") return this.t('g.year_label', {y: key});
      return key;
    },
    getDurKey(dur) {
      if (!dur || dur <= 0) return this.t('g.dur_no_duration');
      const m = dur / 60;
      if (m < 1) return this.t('g.dur_0_1');
      if (m < 3) return this.t('g.dur_1_3');
      if (m < 5) return this.t('g.dur_3_5');
      if (m < 10) return this.t('g.dur_5_10');
      if (m < 30) return this.t('g.dur_10_30');
      if (m < 60) return this.t('g.dur_30_60');
      return this.t('g.dur_60_plus');
    },
  },
};
