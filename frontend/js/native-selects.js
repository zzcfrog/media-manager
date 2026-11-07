// Join each QSelect to its own teleported listbox without wrapping its public API.
const NativeSelects = {
  install(app) {
    const states = new WeakMap();
    const setStyle = (el,key,value) => {
      if(el.style.getPropertyValue(key)!==value)el.style.setProperty(key,value);
    };
    app.mixin({
      mounted() {
        if(this.$options.name!=='QSelect')return;
        const el=this.$el,control=el.querySelector('.q-field__control');
        const state={menu:null,frame:0};
        const detach=()=>{
          state.mutation.disconnect();
          if(state.menu){state.resize.unobserve(state.menu);state.menu.classList.remove('native-select-menu');state.menu.removeAttribute('data-select-side');}
          state.menu=null;el.removeAttribute('data-select-side');
        };
        state.schedule=()=>{
          if(state.frame)return;
          state.frame=requestAnimationFrame(()=>{
            state.frame=0;
            const trigger=el.querySelector('[role="combobox"]');
            const menu=document.getElementById(trigger?.getAttribute('aria-controls'));
            if(trigger?.getAttribute('aria-expanded')!=='true'||!menu?.matches('.q-menu[role="listbox"]')){detach();return;}
            if(state.menu!==menu){detach();state.menu=menu;state.resize.observe(menu);state.mutation.observe(menu,{attributes:true,attributeFilter:['style']});}
            const rect=control.getBoundingClientRect();
            if(!rect.width||rect.bottom<=0||rect.top>=innerHeight){this.hidePopup();detach();return;}
            setStyle(menu,'--native-select-width',rect.width+'px');
            menu.classList.add('native-select-menu');
            const below=Math.max(0,innerHeight-rect.bottom-8),above=Math.max(0,rect.top-8);
            const up=menu.scrollHeight>below&&above>below,side=up?'up':'down';
            el.dataset.selectSide=side;menu.dataset.selectSide=side;
            setStyle(menu,'--native-select-height',(up?above:below)+'px');
            setStyle(menu,'left',rect.left+'px');
            setStyle(menu,'top',(up?rect.top-menu.getBoundingClientRect().height:rect.bottom)+'px');
          });
        };
        state.resize=new ResizeObserver(state.schedule);
        state.mutation=new MutationObserver(state.schedule);
        state.resize.observe(control);
        state.onScroll=()=>{if(state.menu)state.schedule();};
        window.addEventListener('resize',state.schedule);
        window.addEventListener('scroll',state.onScroll,true);
        state.dispose=()=>{cancelAnimationFrame(state.frame);detach();state.resize.disconnect();window.removeEventListener('resize',state.schedule);window.removeEventListener('scroll',state.onScroll,true);};
        states.set(this,state);state.schedule();
      },
      updated(){states.get(this)?.schedule();},
      beforeUnmount(){states.get(this)?.dispose();states.delete(this);}
    });
  }
};
