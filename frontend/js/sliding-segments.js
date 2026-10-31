// One selection plate for mutually exclusive button groups, including unequal widths.
const SlidingSegments = (() => {
  const states = new WeakMap();
  return {
    mounted(el) {
      el.classList.add('sliding-segments');
      const state = {frame:0, readyFrame:0, placed:false, animate:true};
      state.schedule = (animate=true) => {
        state.animate = state.animate && animate;
        if (state.frame) return;
        state.frame = requestAnimationFrame(() => {
          state.frame = 0;
          const button = el.querySelector(':scope > .q-btn[aria-pressed="true"]');
          if (!button?.offsetWidth || !el.offsetWidth) {
            el.style.setProperty('--segment-visible','0');
            el.classList.remove('segments-ready');
            state.placed = false;
            state.animate = true;
            return;
          }
          if (!state.placed || !state.animate) el.classList.remove('segments-ready');
          // Local layout coordinates remain correct while a containing dialog scales in.
          el.style.setProperty('--segment-x',button.offsetLeft+'px');
          el.style.setProperty('--segment-y',button.offsetTop+'px');
          el.style.setProperty('--segment-width',button.offsetWidth+'px');
          el.style.setProperty('--segment-height',button.offsetHeight+'px');
          el.style.setProperty('--segment-visible','1');
          if (!el.classList.contains('segments-ready')) {
            cancelAnimationFrame(state.readyFrame);
            state.readyFrame = requestAnimationFrame(() => el.classList.add('segments-ready'));
          }
          state.placed = true;
          state.animate = true;
        });
      };
      state.observer = new ResizeObserver(() => state.schedule(false));
      state.observer.observe(el);
      states.set(el,state);
      state.schedule(false);
    },
    updated(el) { states.get(el)?.schedule(); },
    unmounted(el) {
      const state = states.get(el);
      if (!state) return;
      state.observer.disconnect();
      cancelAnimationFrame(state.frame);
      cancelAnimationFrame(state.readyFrame);
      states.delete(el);
    }
  };
})();
