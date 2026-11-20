/* =========================================================
   전파 시뮬레이션 결과 뷰어
   ---------------------------------------------------------
   - 모든 영상을 한 화면에, 같은 source 끼리 그룹으로 묶어 배치합니다.
   - 영상마다 재생바가 따로 있고, 처음 열면 모든 영상이 준비되는 순간
     동시에 재생을 시작합니다 (각자 실제 길이대로 → 속도 차이가 그대로 보임).
   - 반복: 영상별 반복(그 영상만 계속 되풀이)과
           전체 반복(가장 늦게 끝나는 영상까지 끝나면 모두 처음부터 동시에 다시 시작).
   - 배속(선택): videos.js 그룹에 rates 를 2개 이상 적으면 그룹 머리에 배속 버튼 표시
       (0.0625×~16× 밖의 배속은 가상 시계에 맞춰 영상 위치를 옮기는 방식으로 흉내 냄)
   ========================================================= */
(() => {
  'use strict';

  const LIB = window.VIDEO_LIBRARY || { videos: [] };
  const VIDEOS = Array.isArray(LIB.videos) ? LIB.videos : [];
  const SET_RESTART_DELAY = 1200; // 전체 반복 시 마지막 화면을 잠깐 보여준 뒤 재시작 (ms)
  const NATIVE_MIN = 0.0625;      // 브라우저 playbackRate 하한 (Chrome 기준)
  const NATIVE_MAX = 16;          // 브라우저 playbackRate 상한

  const $ = (sel, root = document) => root.querySelector(sel);
  const ui = {
    board: $('#board'),
    restart: $('#restartAll'),
    toggle: $('#toggleAll'),
    setLoop: $('#setLoop'),
  };

  /* ---------- 유틸 ---------- */
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const sourceKey = s => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  const rateLabel = r => (r >= 1 ? `${+r.toFixed(2)}×` : `1/${Math.round(1 / r)}×`);
  const setText = (node, s) => { if (node && node.textContent !== s) node.textContent = s; };
  const now = () => performance.now();

  function fmt(t) {
    if (!Number.isFinite(t) || t < 0) t = 0;
    const cs = Math.floor(t * 100 + 1e-6);
    const m = Math.floor(cs / 6000);
    const s = Math.floor(cs / 100) % 60;
    const c = cs % 100;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(c).padStart(2, '0')}`;
  }

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem('mmviewer:' + key);
        return raw === null ? fallback : JSON.parse(raw);
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('mmviewer:' + key, JSON.stringify(value)); } catch { /* 무시 */ }
    },
  };

  const state = {
    setLoop: store.get('setLoop', true) !== false,
  };

  /* ---------- 아이콘 ---------- */
  const ICON = {
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill i-play"><path d="M8 5.2v13.6L18.8 12z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true" class="fill i-pause"><path d="M6.8 5h3.6v14H6.8zM13.6 5h3.6v14h-3.6z"/></svg>',
    loop: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 3l3 3-3 3"/><path d="M4 12v-1a5 5 0 0 1 5-5h11"/><path d="M7 21l-3-3 3-3"/><path d="M20 12v1a5 5 0 0 1-5 5H4"/></svg>',
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    restart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.4-5.7"/><path d="M4 4v4.5h4.5"/></svg>',
  };

  /* =========================================================
     플레이어 — 재생 상태는 반드시 아래 함수들을 통해 다룹니다.
     p.emu 가 있으면 '흉내 재생' 모드: video 는 멈춰 둔 채
     가상 시계(base + 경과시간 × rate)에 맞춰 화면만 옮깁니다.
     ========================================================= */
  const players = [];

  const durOf = p => {
    const d = p.video.duration;
    return Number.isFinite(d) && d > 0 ? d : (p.durHint || Number(p.v.duration) || 0);
  };
  const framesOf = p => Math.max(1, Math.round(durOf(p) * p.fps));
  const frameAt = (p, t) => clamp(Math.floor(t * p.fps + 1e-3), 0, framesOf(p) - 1);
  const frameTime = (p, f) => Math.max(0, Math.min((f + 0.5) / p.fps, durOf(p) - 1e-3));

  function timeOf(p) {
    const e = p.emu;
    if (!e) return p.video.currentTime;
    if (!e.playing) return e.base;
    return clamp(e.base + (now() - e.t0) / 1000 * p.rate, 0, durOf(p));
  }

  function isDone(p) {
    const d = durOf(p);
    if (p.emu) return p.emu.ended || (!p.loop && !p.emu.playing && d > 0 && p.emu.base >= d - 0.03);
    return p.video.ended || (!p.loop && d > 0 && p.video.currentTime >= d - 0.03);
  }

  const isPlayingP = p => (p.emu ? p.emu.playing : !p.video.paused && !isDone(p));

  function playP(p) {
    if (p.emu) {
      if (isDone(p)) p.emu.base = 0;
      p.emu.playing = true;
      p.emu.ended = false;
      p.emu.t0 = now();
    } else {
      if (isDone(p)) p.video.currentTime = 0;
      p.video.play().catch(() => {});
    }
  }

  function pauseP(p) {
    if (p.emu) {
      p.emu.base = timeOf(p);
      p.emu.playing = false;
    } else {
      p.video.pause();
    }
  }

  function seekP(p, t, fast = false) {
    const d = durOf(p);
    t = clamp(t, 0, d);
    if (p.emu) {
      p.emu.base = t;
      p.emu.t0 = now();
      p.emu.ended = false;
      return;
    }
    const target = Math.min(t, Math.max(0, d - 0.5 / p.fps));
    if (fast && typeof p.video.fastSeek === 'function') p.video.fastSeek(target);
    else p.video.currentTime = target;
  }

  function setRateP(p, r) {
    const t = timeOf(p);
    const playing = isPlayingP(p);
    const done = isDone(p);
    const emu = r < NATIVE_MIN || r > NATIVE_MAX;
    p.rate = r;

    if (emu) {
      if (!p.emu) {
        p.video.pause();
        p.emu = { playing, base: t, t0: now(), ended: done, shown: -1 };
      } else {
        p.emu.base = t;
        p.emu.t0 = now();
      }
      p.video.playbackRate = 1;
      p.video.defaultPlaybackRate = 1;
    } else {
      if (p.emu) {
        p.emu = null;
        p.video.loop = p.loop;
        p.video.currentTime = Math.min(t, Math.max(0, durOf(p) - 0.5 / p.fps));
        if (playing) p.video.play().catch(() => {});
      }
      p.video.defaultPlaybackRate = r;
      p.video.playbackRate = r;
    }
  }

  // 화면에 보이는 시간 = 영상 시간 ÷ 배속 (16배속이면 266초 영상이 16.6초로 표시)
  const wallOf = (p, t) => t / (p.rate || 1);

  function setLoopP(p, on) {
    const wasDone = isDone(p); // 반복을 켜면 '끝남' 판정이 바뀌므로 먼저 확인
    p.loop = on;
    p.video.loop = on && !p.emu;
    p.el.loop.setAttribute('aria-pressed', String(on));
    if (on && wasDone) {
      cancelSetRestart();
      seekP(p, 0);
      playP(p);
    }
    if (!on) onEnded();
  }

  // 흉내 재생: 가상 시계를 진행시키고, 화면을 그 위치로 옮김
  function emuStep(p) {
    const e = p.emu;
    if (!e) return;
    const d = durOf(p);
    if (e.playing && d > 0) {
      const t = e.base + (now() - e.t0) / 1000 * p.rate;
      if (t >= d) {
        if (p.loop) {
          e.base = 0;
          e.t0 = now();
        } else {
          e.base = d;
          e.playing = false;
          e.ended = true;
          onEnded();
        }
      }
    }
    const v = p.video;
    if (v.readyState < 1 || v.seeking) return;
    const f = frameAt(p, timeOf(p));
    if (f !== e.shown || Math.abs(frameAt(p, v.currentTime) - f) > 0) {
      e.shown = f;
      v.currentTime = frameTime(p, f);
    }
  }

  function createPlayer(v) {
    const video = document.createElement('video');
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.disableRemotePlayback = true;
    video.setAttribute('muted', '');
    video.setAttribute('playsinline', '');
    video.src = v.file;

    const p = {
      v, video, fps: Number(v.fps) || 30,
      rate: 1, loop: false, emu: null,
      durHint: Number(v.duration) || 0,
      el: {}, scrubbing: false, resumeAfterScrub: false,
    };

    const panel = document.createElement('article');
    panel.className = 'panel';
    panel.dataset.source = sourceKey(v.source);
    const ar = (v.width && v.height) ? v.width / v.height : 1.25;
    panel.style.setProperty('--ar', ar.toFixed(5));
    panel.innerHTML = `
      <header class="panel-head">
        <strong class="panel-title">${esc(v.kind || v.id)}</strong>
        <span class="spacer"></span>
        <button type="button" class="icon-btn" data-act="fs" aria-label="${esc(v.kind)} 전체화면">${ICON.expand}</button>
      </header>
      <div class="panel-body">
        <div class="media">
          <div class="done" hidden>${ICON.check}<span></span></div>
          <div class="msg">불러오는 중…</div>
        </div>
      </div>
      <div class="ctrl">
        <button type="button" class="ctrl-play" aria-label="재생">${ICON.play}${ICON.pause}</button>
        <span class="ctrl-time">00:00.00</span>
        <div class="scrubber" role="slider" tabindex="0" aria-label="${esc(v.source)} ${esc(v.kind)} 재생 위치"
             aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
          <div class="scrub-track">
            <div class="scrub-buffer"></div>
            <div class="scrub-fill"></div>
            <div class="scrub-thumb"></div>
          </div>
          <div class="scrub-tip">00:00.00</div>
        </div>
        <span class="ctrl-dur">${esc(fmt(Number(v.duration) || 0))}</span>
        <button type="button" class="ctrl-loop" aria-pressed="false" aria-label="이 영상만 반복">${ICON.loop}</button>
      </div>`;

    const media = $('.media', panel);
    media.prepend(video);
    p.panel = panel;
    p.el = {
      msg: $('.msg', panel),
      done: $('.done', panel),
      doneText: $('.done span', panel),
      play: $('.ctrl-play', panel),
      time: $('.ctrl-time', panel),
      dur: $('.ctrl-dur', panel),
      loop: $('.ctrl-loop', panel),
      scrubber: $('.scrubber', panel),
      buffer: $('.scrub-buffer', panel),
      fill: $('.scrub-fill', panel),
      thumb: $('.scrub-thumb', panel),
      tip: $('.scrub-tip', panel),
    };

    video.addEventListener('loadedmetadata', () => {
      setText(p.el.dur, fmt(durOf(p)));
      if (video.videoWidth && video.videoHeight) panel.style.setProperty('--ar', (video.videoWidth / video.videoHeight).toFixed(5));
    });
    video.addEventListener('loadeddata', () => { p.el.msg.hidden = true; });
    video.addEventListener('error', () => {
      p.el.msg.hidden = false;
      p.el.msg.classList.add('is-error');
      p.el.msg.textContent = `영상을 불러오지 못했습니다\n${v.file}`;
    });
    video.addEventListener('ended', () => { if (!p.emu) onEnded(); });

    p.el.play.addEventListener('click', () => togglePlayer(p));
    media.addEventListener('click', () => togglePlayer(p));
    media.addEventListener('dblclick', e => { e.preventDefault(); toggleFullscreen(panel); });
    $('[data-act="fs"]', panel).addEventListener('click', () => toggleFullscreen(panel));
    p.el.loop.addEventListener('click', () => setLoopP(p, !p.loop));

    wireScrubber(p);
    players.push(p);
    return p;
  }

  /* ---------- 재생 제어 ---------- */
  let restartToken = 0;
  let setRestartTimer = 0;

  function togglePlayer(p) {
    cancelSetRestart();
    if (isPlayingP(p)) pauseP(p);
    else playP(p);
  }

  // 화면에 띄워진 영상만 (보기 버튼으로 숨긴 영상은 멈춘 채 제외)
  const shown = () => players.filter(p => !p.hidden);
  const anyPlaying = () => shown().some(isPlayingP);

  function toggleAll() {
    cancelSetRestart();
    const list = shown();
    if (list.some(isPlayingP)) list.forEach(pauseP);
    else if (list.every(isDone)) restartAll();
    else list.forEach(p => { if (!isDone(p)) playP(p); });
  }

  // 한 영상이 '현재 위치에서 바로 재생 가능'해질 때까지 기다림
  function whenReady(p) {
    const v = p.video;
    return new Promise(resolve => {
      let timer = 0;
      const done = () => {
        v.removeEventListener('seeked', check);
        v.removeEventListener('canplay', check);
        v.removeEventListener('error', done);
        clearTimeout(timer);
        resolve();
      };
      const check = () => { if (!v.seeking && v.readyState >= 3) done(); };
      v.addEventListener('seeked', check);
      v.addEventListener('canplay', check);
      v.addEventListener('error', done);
      timer = setTimeout(done, 15000);
      check();
    });
  }

  // 영상들을 '화면 시간' wall 에 해당하는 위치(wall × 배속)로 옮긴 뒤,
  // 전부 준비되면 같은 순간에 재생 (play=false 면 위치만 맞춤)
  async function startTogether(list, wall, play = true) {
    list = list.filter(p => !p.hidden);
    cancelSetRestart();
    // 영상마다 '마지막 요청' 번호를 기록 → 다른 그룹의 요청이 이 요청을 취소하지 않음
    const token = ++restartToken;
    list.forEach(p => { p.startToken = token; });
    const targetOf = p => Math.min(wall * (p.rate || 1), Math.max(0, durOf(p) - 0.5 / p.fps));
    list.forEach(p => {
      pauseP(p);
      if (p.video.readyState >= 1) p.video.currentTime = targetOf(p);
      if (p.emu) { p.emu.base = targetOf(p); p.emu.ended = false; p.emu.shown = frameAt(p, targetOf(p)); }
    });
    await Promise.all(list.map(whenReady));
    // 기다리는 사이 같은 영상에 새 요청이 들어왔거나 숨겨진 영상은 제외
    list = list.filter(p => p.startToken === token && !p.hidden);
    if (!list.length) return;
    list.forEach(p => { if (!p.emu && Math.abs(p.video.currentTime - targetOf(p)) > 0.01) p.video.currentTime = targetOf(p); });
    if (play) list.forEach(playP);
  }

  // 처음부터 동시 재생 (기본: 화면에 있는 모든 영상)
  const restartAll = (list = players) => startTogether(list, 0);

  function onEnded() {
    if (!state.setLoop) return;
    const list = shown();
    if (list.every(p => p.loop)) return;
    if (list.every(p => p.loop || isDone(p))) {
      cancelSetRestart();
      setRestartTimer = setTimeout(() => restartAll(), SET_RESTART_DELAY);
    }
  }
  function cancelSetRestart() {
    clearTimeout(setRestartTimer);
    setRestartTimer = 0;
  }

  function setSetLoop(on) {
    state.setLoop = on;
    store.set('setLoop', on);
    ui.setLoop.setAttribute('aria-pressed', String(on));
    if (on) onEnded(); // 이미 다 끝나 있으면 바로 재시작 예약
    else cancelSetRestart();
  }

  /* ---------- 재생바 ---------- */
  function wireScrubber(p) {
    const s = p.el.scrubber;
    const xFrom = e => {
      const r = s.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };

    s.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      cancelSetRestart();
      p.scrubbing = true;
      s.setPointerCapture(e.pointerId);
      s.classList.add('is-scrubbing');
      p.resumeAfterScrub = isPlayingP(p);
      pauseP(p);
      seekP(p, xFrom(e) * durOf(p));
    });
    s.addEventListener('pointermove', e => {
      const x = xFrom(e);
      p.el.tip.style.left = (x * 100) + '%';
      setText(p.el.tip, fmt(wallOf(p, x * durOf(p))));
      if (p.scrubbing) seekP(p, x * durOf(p), true);
    });
    const end = e => {
      if (!p.scrubbing) return;
      p.scrubbing = false;
      s.classList.remove('is-scrubbing');
      if (s.hasPointerCapture(e.pointerId)) s.releasePointerCapture(e.pointerId);
      seekP(p, xFrom(e) * durOf(p));
      if (p.resumeAfterScrub) playP(p);
    };
    s.addEventListener('pointerup', end);
    s.addEventListener('pointercancel', end);

    s.addEventListener('keydown', e => {
      const step = e.shiftKey ? 5 : 1 / p.fps;
      const cur = timeOf(p);
      let t = null;
      if (e.key === 'ArrowLeft') t = cur - step;
      else if (e.key === 'ArrowRight') t = cur + step;
      else if (e.key === 'Home') t = 0;
      else if (e.key === 'End') t = durOf(p);
      if (t === null) return;
      e.preventDefault();
      e.stopPropagation();
      cancelSetRestart();
      pauseP(p);
      seekP(p, t);
    });
  }

  /* ---------- 같은 그룹 영상끼리 맞추기 ---------- */
  // 높은 배속에서는 디코딩 부하로 영상끼리 조금씩 벌어질 수 있어, 화면 시간 기준으로 첫 영상에 맞춤
  const groups = [];
  function alignGroups() {
    for (const group of groups) {
      const list = group.filter(p => !p.hidden);
      if (list.length < 2) continue;
      // 기준 = 배속이 가장 낮은 영상 (디코딩 부담이 적어 시계가 가장 정확)
      const lead = list.reduce((a, b) => (b.rate < a.rate ? b : a));
      if (lead.emu || !isPlayingP(lead) || lead.video.seeking || lead.scrubbing) continue;
      const wall = wallOf(lead, lead.video.currentTime);
      for (const p of list) {
        if (p === lead) continue;
        const v = p.video;
        if (p.emu || !isPlayingP(p) || v.seeking || p.scrubbing) continue;
        const target = wall * p.rate;
        if (target >= durOf(p) - 0.1) continue; // 이 영상은 이미 끝날 시점
        if (Math.abs(v.currentTime - target) > Math.max(0.2, 0.04 * p.rate)) v.currentTime = target;
      }
    }
  }

  /* ---------- 렌더 ---------- */
  function render(p) {
    const d = durOf(p);
    const t = timeOf(p);
    const x = d ? clamp(t / d, 0, 1) : 0;
    const pct = (x * 100).toFixed(3) + '%';
    p.el.fill.style.width = pct;
    p.el.thumb.style.left = pct;
    setText(p.el.time, fmt(wallOf(p, t)));
    setText(p.el.dur, fmt(wallOf(p, d)));

    const b = p.video.buffered;
    let s = 0, e = 0;
    for (let i = 0; i < b.length; i++) {
      if (b.start(i) <= t + 0.25 && b.end(i) >= t) { s = b.start(i); e = b.end(i); break; }
    }
    p.el.buffer.style.left = (d ? s / d * 100 : 0) + '%';
    p.el.buffer.style.width = (d ? (e - s) / d * 100 : 0) + '%';

    const playing = isPlayingP(p);
    if (p.shownPlaying !== playing) {
      p.shownPlaying = playing;
      p.el.play.classList.toggle('is-playing', playing);
      p.el.play.setAttribute('aria-label', playing ? '일시정지' : '재생');
    }

    const done = isDone(p);
    if (p.shownDone !== done) {
      p.shownDone = done;
      p.el.done.hidden = !done;
    }
    if (done) setText(p.el.doneText, `재생 완료 · ${fmt(wallOf(p, d))}`);

    const aria = `${fmt(wallOf(p, t))} / ${fmt(wallOf(p, d))}`;
    if (p.shownAria !== aria) {
      p.shownAria = aria;
      p.el.scrubber.setAttribute('aria-valuenow', (x * 100).toFixed(1));
      p.el.scrubber.setAttribute('aria-valuetext', aria);
    }
  }

  let shownAny = null;
  function tick() {
    requestAnimationFrame(tick);
    const list = shown();
    list.forEach(emuStep);
    alignGroups();
    list.forEach(render);
    const any = anyPlaying();
    if (any !== shownAny) {
      shownAny = any;
      ui.toggle.classList.toggle('is-playing', any);
      setText($('.lbl', ui.toggle), any ? '모두 일시정지' : '모두 재생');
    }
  }

  /* ---------- 전체화면 ---------- */
  function toggleFullscreen(target) {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (target.requestFullscreen) target.requestFullscreen().catch(() => {});
  }

  /* ---------- 화면 구성 ---------- */
  function buildBoard() {
    // source 별로 묶기: groups 에 적힌 순서 → 나머지는 처음 등장한 순서
    const order = [];
    const info = new Map();
    (LIB.groups || []).forEach(g => { order.push(g.source); info.set(g.source, g); });
    VIDEOS.forEach(v => { if (!order.includes(v.source)) order.push(v.source); });

    const frag = document.createDocumentFragment();
    for (const source of order) {
      const vids = VIDEOS.filter(v => v.source === source);
      if (!vids.length) continue;
      const g = info.get(source) || {};
      const views = (Array.isArray(g.views) ? g.views : []).filter(vw => Array.isArray(vw.show) && vw.show.length);
      const rates = (Array.isArray(g.rates) ? g.rates : []).map(Number).filter(r => r > 0);
      const section = document.createElement('section');
      section.className = 'group';
      section.dataset.source = sourceKey(source);
      section.style.setProperty('--n', vids.length);
      section.innerHTML = `
        <header class="group-head">
          <span class="badge">${esc(source)}</span>
          <h2>${esc(g.title || source)}</h2>
          ${g.desc ? `<span class="group-desc">${esc(g.desc)}</span>` : ''}
          <span class="spacer"></span>
          ${views.length > 1 ? `
          <div class="seg-mini view-seg" role="group" aria-label="${esc(g.title || source)} 표시할 영상">
            ${views.map((vw, i) => `<button type="button" data-view="${i}" aria-pressed="false">${esc(vw.label)}</button>`).join('')}
          </div>` : ''}
          ${rates.length > 1 ? `
          <div class="seg-mini rate-seg" role="group" aria-label="${esc(g.title || source)} 재생 배속">
            ${rates.map(r => `<button type="button" data-rate="${r}" aria-pressed="${r === 1}">${rateLabel(r)}</button>`).join('')}
          </div>` : ''}
          ${vids.length > 1 ? `
          <button type="button" class="btn btn-sm group-restart">
            ${ICON.restart}<span>처음부터 동시 재생</span>
          </button>` : ''}
        </header>
        <div class="group-body"></div>`;

      const body = $('.group-body', section);
      const groupPlayers = vids.map(v => createPlayer(v));
      groupPlayers.forEach(p => body.append(p.panel));
      if (groupPlayers.length > 1) groups.push(groupPlayers);

      $('.group-restart', section)?.addEventListener('click', () => restartAll(groupPlayers));

      // 배속 ('속도 비교'에서만 표시): 그룹 안 모든 영상에 같은 배속, 보던 진행 위치는 이어 받음
      const rateSeg = $('.rate-seg', section);
      rateSeg?.addEventListener('click', e => {
        const b = e.target.closest('button[data-rate]');
        if (!b || b.getAttribute('aria-pressed') === 'true') return;
        const r = Number(b.dataset.rate);
        const vis = groupPlayers.filter(p => !p.hidden);
        const ref = vis[0] || groupPlayers[0];
        const x = durOf(ref) ? clamp(timeOf(ref) / durOf(ref), 0, 1) : 0;
        const wasPlaying = vis.some(isPlayingP);
        groupPlayers.forEach(p => setRateP(p, r));
        rateSeg.querySelectorAll('button').forEach(el => el.setAttribute('aria-pressed', String(el === b)));
        if (vis.length) startTogether(vis, x * wallOf(ref, durOf(ref)), wasPlaying);
      });

      // 보기: 그룹 안에서 어떤 영상을 띄울지. 숨긴 영상은 멈추고, 다시 띄우면 보이던 영상 시각에 맞춰 이어 재생
      const viewSeg = $('.view-seg', section);
      const applyView = (i, initial = false) => {
        const show = new Set(views[i].show);
        const ref = groupPlayers.find(p => !p.hidden && show.has(p.v.id)) || groupPlayers.find(p => !p.hidden);
        const refWall = ref ? wallOf(ref, timeOf(ref)) : 0; // 화면 시간 기준
        const refPlaying = ref ? isPlayingP(ref) : false;
        let added = false;
        groupPlayers.forEach(p => {
          const vis = show.has(p.v.id);
          if (vis === !p.hidden) return;
          p.hidden = !vis;
          p.panel.hidden = !vis;
          if (!vis) {
            pauseP(p);
          } else if (!initial && ref) {
            added = true;
          }
        });
        // 새로 띄운 영상이 준비될 때까지 잠깐 기다렸다가, 보이는 영상들을 같은 화면 시간에서 함께 재생
        if (added) startTogether(groupPlayers, refWall, refPlaying);
        const visibleCount = groupPlayers.filter(p => !p.hidden).length;
        section.style.setProperty('--n', visibleCount);
        // 그룹 '처음부터 동시 재생'은 영상이 둘 이상 보일 때만 의미가 있으므로 그때만 표시
        const groupRestart = $('.group-restart', section);
        if (groupRestart) groupRestart.hidden = visibleCount < 2;
        if (!initial) updateBoardColumns();
        viewSeg?.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(Number(x.dataset.view) === i)));
        if (!initial) onEnded(); // 남은 영상이 모두 끝나 있으면 전체 반복 조건 다시 확인
      };
      if (views.length) {
        applyView(clamp(Number(g.defaultView) || 0, 0, views.length - 1), true);
        viewSeg?.addEventListener('click', e => {
          const b = e.target.closest('button[data-view]');
          if (b) applyView(Number(b.dataset.view));
        });
      }

      frag.append(section);
    }
    ui.board.replaceChildren(frag);
    updateBoardColumns();
  }

  // 그룹 너비 = 보이는 영상 수에 비례 (영상 하나하나가 같은 크기가 되도록)
  function updateBoardColumns() {
    const cols = [...ui.board.querySelectorAll(':scope > .group')]
      .map(s => `minmax(0, ${Number(s.style.getPropertyValue('--n')) || 1}fr)`).join(' ');
    ui.board.style.setProperty('--cols', cols);
  }

  /* ---------- 단축키 ---------- */
  document.addEventListener('keydown', e => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    let handled = true;
    // 한글 입력 상태에서도 동작하도록 e.code 기준
    switch (e.code) {
      case 'Space': toggleAll(); break;
      case 'KeyR': restartAll(); break;
      case 'KeyL': setSetLoop(!state.setLoop); break;
      case 'KeyF': toggleFullscreen(document.documentElement); break;
      default: handled = false;
    }
    if (handled) e.preventDefault();
  });

  /* ---------- 초기화 ---------- */
  function init() {
    if (!VIDEOS.length) {
      ui.board.innerHTML = '<p class="empty">assets/js/videos.js 에 등록된 영상이 없습니다.</p>';
      return;
    }
    if (LIB.title) {
      setText($('#libTitle'), LIB.title);
      document.title = LIB.title;
    }
    ui.setLoop.setAttribute('aria-pressed', String(state.setLoop));

    ui.restart.addEventListener('click', () => restartAll());
    ui.toggle.addEventListener('click', toggleAll);
    ui.setLoop.addEventListener('click', () => setSetLoop(!state.setLoop));

    buildBoard();
    requestAnimationFrame(tick);
    restartAll(); // 처음 들어오면 모든 영상이 준비되는 대로 동시에 재생 시작
  }

  init();
})();
