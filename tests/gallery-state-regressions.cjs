const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const location = { hash: '#/gallery' };
const context = vm.createContext({ console, location, window: { location }, localStorage: { getItem() { return null; }, setItem() {} },
  document: { querySelector() { return null; } }, requestAnimationFrame: fn => fn(),
  t: key => key, API: {}, Quasar: { Notify: { create() {} } }, Vue: { createApp: options => options } });
for (const file of ['format.js', 'taxonomy.js', 'people.js', 'gallery.js', 'detail.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js', file), 'utf8'), context);
const index = fs.readFileSync(path.join(__dirname, '../frontend/index.html'), 'utf8');
vm.runInContext(index.slice(index.indexOf('const app = Vue.createApp('), index.indexOf('app.use(Quasar')), context);
const root = vm.runInContext('app', context), gallery = vm.runInContext('GalleryPage', context), detail = vm.runInContext('DetailPage', context);
function bind(component, fields) {
  const state = { ...fields };
  for (const [name, fn] of Object.entries(component.methods)) if (typeof fn === 'function') state[name] = fn.bind(state);
  return state;
}
function galleryState(fields = {}) {
  const state = bind(gallery, { ...gallery.data(), $root: { pickerMode: false, route: '#/favorites', currentView: 'gallery' }, $nextTick() {}, ...fields });
  for (const [name, fn] of Object.entries(gallery.computed)) Object.defineProperty(state, name, { get: () => fn.call(state) });
  return state;
}
const tests = [], test = (name, run) => tests.push({ name, run });
test('detail returns to its origin rather than a hardcoded library', () => {
  let called = 0;
  detail.methods.goBack.call({ $root: { returnFromDetail() { called++; } } });
  assert.equal(called, 1);
});
test('favorites, people and a nested folder restore without reloading or clearing selection', () => {
  for (const route of ['#/favorites', '#/gallery', '#/people/person/4']) {
    let loads = 0;
    const g = galleryState({ items: [{ id: 1, file_path: '/elsewhere/image.jpg' }], selArr: [1], page: 4, favFilter: 'fav',
      savedScrollTop: 630, $refs: { galleryPage: { scrollTop: 630 } } });
    g.load = () => loads++;
    const state = bind(root, { route, currentView: 'gallery', selectedFolder: route === '#/gallery' ? '/photos/nested' : null,
      libraryExpanded: route !== '#/favorites', peopleQuery:{person_ids:[4],person_mode:'all'},peopleSelected:4,taxonomyQuery:{tag_ids:[7]}, galleryItems: [], $refs: { gallery: g }, $nextTick: fn => fn() });
    const folder = state.selectedFolder;
    location.hash = '#/detail/1'; state.resolveRoute();
    state.$refs.gallery = null;
    state.returnFromDetail(); state.$refs.gallery = g; state.resolveRoute();
    assert.equal(location.hash, route); assert.equal(state.selectedFolder, folder);
    assert.equal(g.page, 4); assert.deepEqual(Array.from(g.selArr), [1]); assert.equal(loads, 0);
    assert.equal(g.$refs.galleryPage.scrollTop, 630);
  }
});
test('explicit sidebar folder selection from detail is respected', () => {
  const state = bind(root, { route: '#/detail/1', currentView: 'detail', selectedFolder: '/old',
    detailOrigin: { route: '#/gallery', selectedFolder: '/old' }, $refs: {}, $nextTick: fn => fn() });
  location.hash = '#/detail/1'; state.onFolderSelect('/new'); state.resolveRoute();
  assert.equal(state.selectedFolder, '/new'); assert.equal(state.currentView, 'gallery');
});
test('stack mode stays scoped to favorites and has an off switch', () => {
  const state = galleryState({ stackMode: 'similar', favFilter: 'fav' });
  assert.equal(state._buildParams(1).stack_type, 'similar');
  state.$root.route = '#/gallery'; assert.equal(state._buildParams(1).stack_type, undefined);
  state.$root.route = '#/favorites'; state.stackMode = 'off'; assert.equal(state._buildParams(1).stack_type, undefined);
});
test('direct detail links return safely to the library', () => {
  const state = bind(root, { detailOrigin: null });
  state.returnFromDetail(); assert.equal(location.hash, '#/gallery');
});
test('detail pagination uses its cached gallery and keeps the original query', async () => {
  const calls = [];
  context.API.getLibrary = async params => { calls.push(params); return { data: [{ id: 2 }], pagination: { total: 2 } }; };
  const state = bind(root, { route: '#/detail/1', currentView: 'detail', selectedFolder: '/photos/nested',
    searchQuery: 'lake', detailOrigin: { route: '#/favorites' }, galleryItems: [{ id: 1 }], $refs: {} });
  const g = galleryState({ $root: state, items: [{ id: 1 }], page: 1, perPage: 1, favFilter: 'fav', stackMode: 'near' });
  state._detailGallery = g;
  assert.equal(await state.getAdjacentId(1, 1), 2);
  assert.equal(calls[0].stack_type, 'near'); assert.equal(calls[0].folder, '/photos/nested');
  assert.equal(calls[0].q, 'lake'); assert.equal(calls[0].page, 2);
});
test('a delayed next-photo request cannot reopen detail after returning', async () => {
  let finish;
  const state = { media: { id: 1 }, $root: { currentView: 'detail', detailId: 1, _routeGeneration: 1,
    getAdjacentId: () => new Promise(resolve => finish = resolve) } };
  const running = detail.methods.handleKey.call(state, { key: 'ArrowRight', target: { tagName: 'DIV', closest: () => null },
    preventDefault() {}, stopPropagation() {} });
  state.$root.currentView = 'gallery'; state.$root._routeGeneration++;
  location.hash = '#/favorites'; finish(2); await running;
  assert.equal(location.hash, '#/favorites');
});
test('normal next-photo navigation still works inside detail', async () => {
  const state = { media: { id: 1 }, $root: { currentView: 'detail', detailId: 1, _routeGeneration: 1,
    getAdjacentId: async () => 2 } };
  await detail.methods.handleKey.call(state, { key: 'ArrowRight', target: { tagName: 'DIV', closest: () => null },
    preventDefault() {}, stopPropagation() {} });
  assert.equal(location.hash, '#/detail/2');
});
test('collapsed stacks preserve every original and expand without changing selection', () => {
  const members = [{ id: 1, media_type: 'image' }, { id: 2, media_type: 'image' }, { id: 3, media_type: 'image' }];
  const cover = { ...members[0], stack_items: members };
  const state = galleryState({ items: [cover, { id: 4, media_type: 'video' }], selArr: [1], stackMode: 'near' });
  assert.deepEqual(Array.from(state.displayItems, x => x.id), [1, 4]);
  assert.deepEqual(Array.from(state.allMediaItems, x => x.id), [1, 2, 3, 4]);
  state.toggleStack(cover);
  assert.deepEqual(Array.from(state.displayItems, x => x.id), [1, 2, 3, 4]);
  assert.deepEqual(Array.from(state.selArr), [1]);
  state.selArr = [2]; state.toggleStack(cover);
  assert.deepEqual(Array.from(state.selArr), [1]); // never leave hidden selected files for destructive actions
  assert.deepEqual(Array.from(state.displayItems, x => x.id), [1, 4]);
});
test('old stack request cannot replace a newer tier', async () => {
  const pending = {};
  context.API.getLibrary = params => new Promise(resolve => pending[params.stack_type] = resolve);
  const state = galleryState({ stackMode: 'near', favFilter: 'fav' });
  state._loadFacets = () => {};
  const old = state.load(); state.stackMode = 'similar'; const current = state.load();
  pending.similar({ data: [{ id: 2 }], pagination: { total: 1 } }); await current;
  pending.near({ data: [{ id: 1 }], pagination: { total: 1 } }); await old;
  assert.equal(state.items[0].id, 2);
});
test('edited detail data refreshes loaded pages without resetting context', async () => {
  const state = galleryState({ page: 2, selArr: [1, 2], expandedStacks: [1], $root: { route: '#/favorites', currentView: 'gallery', detailLibraryDirty: true },
    favFilter: 'fav', sortBy: 'file_name', perPage: 1, $nextTick: async () => {} });
  context.API.getLibrary = async params => ({ data: params.page === 1 ? [{ id: 1, rating: 5 }] : [{ id: 3 }],
    pagination: { total: 2, pages: 2 } });
  await state.refreshAfterDetail();
  assert.equal(state.page, 2); assert.equal(state.sortBy, 'file_name'); assert.equal(state.items[0].rating, 5);
  assert.deepEqual(Array.from(state.selArr), [1]); assert.equal(state.$root.detailLibraryDirty, false);
  assert.equal(state.loading, false);
});
test('failed detail refresh keeps old rows, releases loading and remains retryable', async () => {
  const state = galleryState({ items: [{ id: 1 }], page: 1, loading: true, $root: { detailLibraryDirty: true } });
  context.API.getLibrary = async () => { throw Error('isolated refresh failure'); };
  await state.refreshAfterDetail();
  assert.equal(state.items[0].id, 1); assert.equal(state.loading, false); assert.equal(state.$root.detailLibraryDirty, true);
});
test('deleting a stack cover retains its other originals if refresh fails', async () => {
  const members = [{ id: 1 }, { id: 2 }, { id: 3 }];
  const state = galleryState({ items: [{ ...members[0], stack_items: members }], total: 3, selArr: [1], favFilter: 'fav' });
  state.refreshAfterDetail = async () => {};
  await state.removeDeletedItems([1]);
  assert.deepEqual(Array.from(state.allMediaItems, item => item.id), [2, 3]);
  assert.equal(state.items[0].id, 2); assert.equal(state.total, 2); assert.equal(state.selArr.length, 0);
});
test('footer previews selected tag paths, match mode and descendant scope', () => {
  const state=galleryState({$root:{pickerMode:false,route:'#/classify',taxonomyQuery:{tag_ids:[3],tag_mode:'all',include_children:false},taxonomyNodes:[{id:3,path:'场景 / 山川',name:'山川'}]}});
  const preview=state.activeFilterTags.map(tag=>tag.label || '').join(' ');
  assert(preview.includes('场景 / 山川'));assert(preview.includes('全部'));assert(preview.includes('仅所选标签'));
  state.$root.taxonomyQuery={};assert(!state.activeFilterTags.some(tag=>tag.icon==='sell'));
});
test('smart collections have a stable navigable route', () => {
  const state=bind(root,{route:'#/gallery'});state.openTaxonomyCollection({id:7});assert.equal(location.hash,'#/classify/collection/7');
});
test('saved collection conditions populate visible controls instead of overriding them', async () => {
  context.API._fetch=async()=>({query:{tag_ids:[3],tag_mode:'all',include_children:false,media_type:'image',favorite:'true',q:'山',folder:'/photos',rating:4,sort:'rating',order:'desc'}});
  const state=bind(root,{route:'#/classify/collection/7',taxonomyQuery:{},$refs:{}});
  const g=galleryState({$root:state});let calls=0;g.load=async()=>{calls++;};state.$refs.gallery=g;
  await state.loadTaxonomyCollection(7);assert.equal(calls,1);assert.equal(g.filters.media_type,'image');assert.equal(g.favFilter,'fav');assert.equal(g.searchText,'山');assert.equal(g.filters.rating,4);assert.equal(state.selectedFolder,'/photos');assert.equal(state.taxonomyQuery.media_type,undefined);
  g.filters.media_type='video';assert.equal(g._buildParams(1).media_type,'video');assert.equal(g._buildParams(1).tag_ids,'3');assert.equal(state.taxonomyCollectionLoading,false);
});
test('a late collection read cannot overwrite a newer navigation', async () => {
  let resolve;context.API._fetch=()=>new Promise(r=>resolve=r);
  const state=bind(root,{route:'#/classify/collection/7',taxonomyQuery:{},$refs:{}});const g=galleryState({$root:state});let calls=0;g.load=async()=>{calls++;};state.$refs.gallery=g;
  const pending=state.loadTaxonomyCollection(7);state.route='#/favorites';state.taxonomyQuery={tag_ids:[9]};resolve({query:{tag_ids:[3]}});await pending;
  assert.deepEqual(state.taxonomyQuery.tag_ids,[9]);assert.equal(calls,0);
});
(async () => { let failed = 0; for (const { name, run } of tests) {
  try { await run(); console.log('PASS', name); } catch (error) { failed++; console.error('FAIL', name, error.message); }
} console.log(`${tests.length - failed}/${tests.length} passed`); if (failed) process.exitCode = 1; })();
