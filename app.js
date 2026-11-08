/* Aurora redesign prototype: scripted, fictional data. One shared state, hash routes. */
(function () {
  'use strict';

  var I = 'assets/icons/';
  var root = document.getElementById('root');
  var live = document.getElementById('live');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* ---------- Script ---------- */

  // Delay of each step after the previous one (ms). Demo pacing, not real response times.
  var STEP_DELAYS = [2000, 5000, 8000, 10000, 10000];

  var BUSINESSES = [
    { id: 'hh',  name: 'Home Helpers' },
    { id: 'khh', name: 'Kitchen Home Helpers' },
    { id: 'scs', name: 'Shree Cook Services' },
    { id: 'ann', name: 'Annapurna Cook Services' },
    { id: 'ras', name: 'Rasoi Ghar Services' },
    { id: 'dtc', name: 'Daily Tiffin & Cook' },
    { id: 'mhc', name: 'Marwar Home Care' }
  ];

  // Call status of each business after each step (index = step).
  // q queued · r ringing · c on a call · x reached, no useful information · a answered · n no answer
  var STEPS = [
    null,                                                                   // 0 preparing
    { hh: 'c', khh: 'r', scs: 'r', ann: 'q', ras: 'q', dtc: 'q', mhc: 'q' }, // 1 waiting
    { hh: 'x', khh: 'c', scs: 'r', ann: 'r', ras: 'q', dtc: 'q', mhc: 'q' }, // 2 first call, no useful information
    { hh: 'x', khh: 'a', scs: 'c', ann: 'r', ras: 'r', dtc: 'q', mhc: 'q' }, // 3 first answer
    { hh: 'x', khh: 'a', scs: 'a', ann: 'c', ras: 'n', dtc: 'r', mhc: 'r' }, // 4 second answer
    { hh: 'x', khh: 'a', scs: 'a', ann: 'a', ras: 'n', dtc: 'n', mhc: 'x' }  // 5 complete
  ];

  var ANSWERS = {
    khh: {
      name: 'Kitchen Home Helpers', area: 'Nakoda Nagar, Jodhpur', photo: 'assets/kitchen-home-helpers.png',
      price: '₹4,500/month', brief: 'Price received', caveat: 'Timing still unconfirmed',
      rows: [['Price', '₹4,500/month', true], ['Cooking help', 'Available', true], ['Daily at 8 AM', 'Not confirmed', false], ['Dietary requirements', 'Not confirmed', false]]
    },
    scs: {
      name: 'Shree Cook Services', area: 'Ratanada, Jodhpur', photo: null,
      price: '₹5,000/month', brief: 'Price and timing received', caveat: 'Dietary requirements unconfirmed',
      rows: [['Price', '₹5,000/month', true], ['Cooking help', 'Available', true], ['Daily at 8 AM', 'Confirmed', true], ['Dietary requirements', 'Not confirmed', false]]
    },
    ann: {
      name: 'Annapurna Cook Services', area: 'Sardarpura, Jodhpur', photo: null,
      price: '₹4,800/month', brief: 'Price received', caveat: 'Timing still unconfirmed',
      rows: [['Price', '₹4,800/month', true], ['Cooking help', 'Available', true], ['Daily at 8 AM', 'Not confirmed', false], ['Dietary requirements', 'Not confirmed', false]]
    }
  };
  var ANSWER_ORDER = ['khh', 'scs', 'ann'];

  var OPENING = [
    { from: 'user', text: 'I need a cook for my mother.' },
    { from: 'user', text: 'A cook daily at 8 AM, within ₹4,000–5,000 a month.' },
    { from: 'aurora', text: 'Got it. I’ll call nearby businesses to check daily cooking help at 8 AM within your ₹4,000–5,000 monthly budget. I’ll share their answers here as they come in.' }
  ];

  /* ---------- State ---------- */

  var state;
  var timers = [];

  function freshState() {
    return {
      started: false,
      phase: 'preparing',   // preparing | running | complete | stopped
      step: 0,              // index into STEPS reached so far
      sheet: false,
      messages: OPENING.map(function (m) { return { from: m.from, text: m.text }; }),
      resultsFrom: null,    // first message shown under the results layout
      prev: 'chat'          // where the Live progress back button returns to
    };
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function later(fn, ms) {
    var id = setTimeout(function () {
      timers = timers.filter(function (t) { return t !== id; });
      fn();
    }, ms);
    timers.push(id);
  }

  function startSearch() {
    clearTimers();
    state.started = true;
    state.phase = 'preparing';
    state.step = 0;
    var at = 0;
    STEP_DELAYS.forEach(function (d, i) {
      at += d;
      later(function () { advance(i + 1); }, at);
    });
  }

  function advance(step) {
    if (state.phase === 'stopped' || state.phase === 'complete') return;
    state.step = step;
    state.phase = step === STEPS.length - 1 ? 'complete' : 'running';
    if (state.phase === 'complete') {
      state.sheet = false;
      announce('Search complete. ' + plural(answerCount(), 'business response', 'business responses') + '.');
    } else if (step === 1) {
      announce('Calls started. No answers yet.');
    } else if (step === 2) {
      announce('Home Helpers call ended without price or availability. Other calls continue.');
    } else {
      announce(plural(answerCount(), 'answer', 'answers') + ' available. Search still in progress.');
    }
    update();
  }

  function stopSearch() {
    clearTimers();
    state.phase = 'stopped';
    state.sheet = false;
    if (answerCount() === 0) {
      state.messages.push({ from: 'aurora', text: 'Your search has stopped. You can start again whenever you are ready.' });
    }
    announce('Search stopped. ' + (answerCount() ? plural(answerCount(), 'answer', 'answers') + ' collected before stopping.' : 'No answers collected.'));
    if (route() === 'answers') go('chat'); else update();
  }

  function restartSearch(msg) {
    clearTimers();
    state = freshState();
    startSearch();
    announce(msg);
    if (route() === 'chat') update(true); else go('chat');
  }

  /* ---------- Derived ---------- */

  // Statuses after the current step. Once stopped, unfinished calls are marked as stopped.
  function statuses() {
    if (state.step === 0) return null;
    var s = STEPS[state.step];
    if (state.phase !== 'stopped') return s;
    var out = {};
    Object.keys(s).forEach(function (k) {
      out[k] = s[k] === 'c' ? 'sc' : s[k] === 'r' ? 'sr' : s[k] === 'q' ? 'sq' : s[k];
    });
    return out;
  }

  function answered() {
    var s = statuses();
    if (!s) return [];
    return ANSWER_ORDER.filter(function (id) { return s[id] === 'a'; });
  }

  function answerCount() { return answered().length; }

  function counts() {
    var s = statuses() || {};
    var c = { q: 0, r: 0, c: 0, x: 0, a: 0, n: 0, sc: 0, sr: 0, sq: 0 };
    Object.keys(s).forEach(function (k) { c[s[k]]++; });
    return c;
  }

  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : many); }

  function callLine(c, withQueued) {
    var parts = [];
    if (c.c) parts.push(c.c + ' on a call');
    if (c.r) parts.push(c.r + ' ringing');
    if (withQueued && c.q) parts.push(c.q + ' queued');
    return parts.join(' · ') || 'No calls are running';
  }

  /* ---------- Routing ---------- */

  function route() {
    var r = (location.hash || '').replace(/^#\/?/, '');
    return ['intro', 'chat', 'answers', 'progress'].indexOf(r) >= 0 ? r : 'intro';
  }

  function go(r) {
    if (route() === r) { update(true); return; }
    location.hash = '#/' + r;
  }

  window.addEventListener('hashchange', function () { update(true); });

  /* ---------- Helpers ---------- */

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function img(name, w, h, cls) {
    return '<img src="' + I + name + '.svg" width="' + w + '" height="' + h + '" alt=""' + (cls ? ' class="' + cls + '"' : '') + '>';
  }

  function announce(text) {
    live.textContent = '';
    setTimeout(function () { live.textContent = text; }, 30);
  }

  function nowTime() {
    return new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  /* ---------- Intro ---------- */

  function introView() {
    return '' +
      '<main class="intro">' +
        '<div class="intro-copy">' +
          '<header class="intro-head">' +
            '<p class="intro-eyebrow">Aurora / Product design exploration</p>' +
            '<h1 class="intro-title">Making the wait clearer</h1>' +
          '</header>' +
          '<section><h2 class="intro-label">My experience</h2>' +
            '<p class="intro-body">I used Aurora to find a cook for my mother. I could see businesses being found and called, but I was unsure what useful information was available while I waited.</p></section>' +
          '<section><h2 class="intro-label">The problem</h2>' +
            '<p class="intro-body">The search card could scroll out of view as the conversation continued. Basic call details were inside Live progress, so I had to open another view to check the search.</p></section>' +
          '<section><h2 class="intro-label">Design intent</h2>' +
            '<p class="intro-intent">Keep essential search status and available answers visible while the user continues chatting.</p></section>' +
          '<a class="intro-cta" href="#/chat">Start prototype</a>' +
        '</div>' +
        '<figure class="intro-before">' +
          '<figcaption class="intro-label">Existing app / before</figcaption>' +
          '<div class="before-row">' +
            '<div class="before-shot">' +
              '<div class="before-frame"><img src="assets/before-chat.png" width="591" height="1280" alt="Existing app: the in-progress search card sits between chat messages and scrolls away with them."><span class="before-num" aria-hidden="true">1</span></div>' +
              '<p class="before-note">The card can scroll out of view while users keep chatting.</p>' +
            '</div>' +
            '<div class="before-shot">' +
              '<div class="before-frame"><img src="assets/before-progress.png" width="591" height="1280" alt="Existing app: call details are on a separate Live progress screen."><span class="before-num" aria-hidden="true">2</span></div>' +
              '<p class="before-note">Call details need another view. Counts do not explain whether useful answers are available in chat.</p>' +
            '</div>' +
          '</div>' +
        '</figure>' +
        '<footer class="intro-foot">' +
          '<p>Personal experience • Not a user study</p>' +
          '<p>The prototype uses scripted, fictional businesses, prices and calls. Its timings are not real response times.</p>' +
        '</footer>' +
      '</main>';
  }

  /* ---------- Phone shell ---------- */

  function shell(inner) {
    return '' +
      '<div class="stage">' +
        '<div class="stage-bar">' +
          '<a class="stage-link" href="#/intro">About this prototype</a>' +
          '<p class="stage-note">Scripted demo · Fictional businesses, prices and calls · Timings are not real response times</p>' +
          '<button type="button" class="stage-restart" data-act="restart">Restart demo</button>' +
        '</div>' +
        '<div class="device" id="device"><div class="phone" id="phone">' + inner +
          '<span class="island" aria-hidden="true"></span></div></div>' +
        '<p class="stage-foot">Menu, location, call, share, map, save, view all, voice and attachment controls are not active in this prototype.</p>' +
      '</div>';
  }

  function statusBar() {
    return '<div class="statusbar" aria-hidden="true"><img src="' + I + 'statusbar.svg" width="390" height="47" alt=""></div>';
  }

  function header() {
    return '' +
      '<div class="conv-head">' +
        '<span class="menu-btn" aria-hidden="true"><i></i><i></i></span>' +
        '<div class="conv-titles">' +
          '<h1 class="conv-title">Cook for my mother</h1>' +
          '<p class="conv-loc">' + img('pin', 14, 14) + '<span>Nakoda Nagar</span>' + img('chev-down', 13, 13) + '</p>' +
        '</div>' +
      '</div>';
  }

  function composer(compact) {
    var tools = '<span class="cmp-tool" aria-hidden="true">' + img('sliders', 17, 15) + '</span>' +
      '<span class="cmp-tool" aria-hidden="true">' + img('mic', 17, 18) + '</span>' +
      '<button type="submit" class="cmp-voice" aria-label="Send message">' + img('voice', 18, 12) + '</button>';
    var plus = '<span class="cmp-plus" aria-hidden="true">' + img('plus', 18, 18) + '</span>';
    var input = '<label class="sr" for="msg">Message Aurora</label>' +
      '<input id="msg" class="cmp-input" type="text" placeholder="Ask for anything" autocomplete="off" enterkeyhint="send">';
    if (compact) {
      return '<form class="composer composer-compact" data-form="msg">' + plus + input + tools + '</form>';
    }
    return '<form class="composer" data-form="msg">' + input +
      '<div class="cmp-row">' + plus + '<span class="cmp-gap"></span>' + tools + '</div></form>';
  }

  /* ---------- Search status card ---------- */

  function statusCard() {
    var p = state.phase;
    var n = answerCount();
    var s = statuses();

    if (p === 'preparing') {
      return cardFrame('preparing', 'Preparing your search', 'Getting your search ready', true,
        '<div class="sk-row" aria-hidden="true"><span class="sk-tile"></span><span class="sk-lines"><span class="sk sk-a"></span><span class="sk sk-b"></span></span></div>',
        '<span class="sk sk-c" aria-hidden="true"></span><span class="sr">Calls have not started yet.</span>', 'progress');
    }

    if (p === 'stopped' && n === 0) {
      return cardFrame('stopped', 'Stopped by you', 'No answers collected', false,
        row('Search ended', 'No business answers received.'),
        'No calls are running', 'again');
    }

    var title, body;
    if (n === 0) {
      title = 'No answers yet';
      body = s.hh === 'c'
        ? row('Home Helpers', 'On a call · Checking your requirements')
        : row('Home Helpers', 'Couldn’t confirm price or availability.');
    } else if (n === 1) {
      var a = ANSWERS[answered()[0]];
      title = '1 answer available';
      body = row(a.name, a.price + ' · ' + a.brief, a.caveat, true);
    } else {
      title = n + ' answers available';
      body = row('Answers from ' + n + ' businesses', null, null, true);
    }
    return cardFrame('running', 'In progress', title, true, body, callLine(counts(), false), 'progress');
  }

  function row(name, sub, warn, arrow) {
    return '<div class="sc-row">' +
      '<span class="sc-tile" aria-hidden="true">' + img('phone-tile', 31, 31) + '</span>' +
      '<div class="sc-text"><p class="sc-name">' + esc(name) + '</p>' +
        (sub ? '<p class="sc-sub">' + esc(sub) + '</p>' : '') +
        (warn ? '<p class="sc-warn">' + esc(warn) + '</p>' : '') +
      '</div>' +
      (arrow ? '<button type="button" class="sc-arrow" data-act="answers" aria-label="View business ' + (answerCount() === 1 ? 'response' : 'responses') + '">' + img('arrow', 32, 32) + '</button>' : '') +
    '</div>';
  }

  function cardFrame(kind, label, title, canStop, body, footLeft, link) {
    var btn = canStop
      ? '<button type="button" class="sc-stop" data-act="stop">Stop search</button>'
      : '<span class="sc-stop is-static">Stopped</span>';
    var linkHtml = link === 'again'
      ? '<button type="button" class="sc-link" data-act="again">Search again</button>'
      : '<button type="button" class="sc-link" data-act="progress">Live progress</button>';
    return '<section class="sc sc-' + kind + '" aria-label="Search status">' +
      '<span class="sc-glow" aria-hidden="true"></span>' +
      (canStop ? '<span class="sc-line" aria-hidden="true"></span>' : '') +
      '<div class="sc-top"><p class="sc-label"><span class="sc-dot" aria-hidden="true"></span>' + esc(label) + '</p>' + btn + '</div>' +
      '<div class="sc-swap" data-swap="' + esc(title + '|' + (body.length)) + '"><h2 class="sc-title">' + esc(title) + '</h2>' + body + '</div>' +
      '<div class="sc-foot"><p class="sc-counts">' + footLeft + '</p>' + linkHtml + '</div>' +
    '</section>';
  }

  // Compact bar used above the results layout.
  function compactBar(kind) {
    var icon, text, link;
    if (kind === 'stopped') { icon = img('stop', 20, 20); text = 'Stopped by you'; link = '<button type="button" class="cb-link" data-act="progress">Search activity</button>'; }
    else if (kind === 'complete') { icon = checkSvg(); text = 'Search complete'; link = '<button type="button" class="cb-link" data-act="progress">Search activity</button>'; }
    else { icon = '<span class="cb-live"><span></span></span>'; text = 'Search continues'; link = '<button type="button" class="cb-link" data-act="chat">Back to chat</button>'; }
    return '<section class="cb" aria-label="Search status"><span class="sc-glow cb-glow" aria-hidden="true"></span>' +
      '<span class="cb-icon" aria-hidden="true">' + icon + '</span><p class="cb-text">' + text + '</p>' + link + '</section>';
  }

  function checkSvg() {
    return '<svg width="20" height="20" viewBox="0 0 20 20" fill="none"><rect width="20" height="20" rx="10" fill="#E8F7F1"/><path d="M6.25 10L8.75 12.5L13.75 7.5" stroke="#109D80" stroke-width="1.0625" stroke-linecap="round" stroke-linejoin="round"/></svg>';
  }

  /* ---------- Results ---------- */

  function results(heading, countText) {
    return '<section class="results" aria-label="' + esc(heading) + '">' +
      '<div class="res-head"><div><h2 class="res-title">' + esc(heading) + '</h2><p class="res-count">' + esc(countText) + '</p></div>' +
        '<span class="res-all" aria-hidden="true">View all ' + img('chev', 15, 15) + '</span></div>' +
      '<div class="carousel" role="list">' + answered().map(bizCard).join('') + '</div>' +
    '</section>';
  }

  function bizCard(id) {
    var a = ANSWERS[id];
    var photo = a.photo
      ? '<img class="bc-photo" src="' + a.photo + '" width="296" height="148" alt="">'
      : '<span class="bc-photo bc-photo-empty" aria-hidden="true"></span>';
    var rows = a.rows.map(function (r) {
      return '<div class="rs-row"><dt>' + r[0] + '</dt><dd>' + r[1] +
        (r[2] ? '<span class="rs-yes" role="img" aria-label="(confirmed)">' + img('check-badge', 14, 14) + '</span>'
              : '<span class="rs-q" role="img" aria-label="(not confirmed)"><span aria-hidden="true">?</span></span>') + '</dd></div>';
    }).join('');
    return '<article class="bc" role="listitem" aria-label="' + esc(a.name) + '">' + photo +
      '<div class="bc-info"><h3 class="bc-name">' + esc(a.name) + '</h3><p class="bc-area">' + esc(a.area) + '</p>' +
        '<p class="bc-src">' + img('phone', 16, 16) + 'Reported by phone</p></div>' +
      '<div class="rs"><p class="rs-label"><span aria-hidden="true">✧</span> Request summary</p><dl>' + rows + '</dl></div>' +
      '<div class="bc-actions" aria-hidden="true"><span class="bc-call">' + img('phone', 16, 16, 'bc-call-ic') + 'Call</span>' +
        '<span class="bc-ic">' + img('share', 19, 19) + '</span><span class="bc-ic">' + img('map', 19, 19) + '</span></div>' +
    '</article>';
  }

  /* ---------- Chat ---------- */

  function messagesHtml(from) {
    return state.messages.slice(from || 0).map(function (m) {
      var b = '<div class="msg msg-' + m.from + '"><p>' + esc(m.text) + '</p></div>';
      if (m.from === 'aurora' && m.time) {
        b += '<div class="msg-meta" aria-hidden="true">' + thumbs() + '<span>' + esc(m.time) + '</span></div>';
      }
      return b;
    }).join('');
  }

  // In the results layout, only messages typed after the search ended appear below the cards.
  function threadHtml() {
    if (layoutKey() === 'chat-live') return messagesHtml(0);
    return state.resultsFrom == null ? '' : messagesHtml(state.resultsFrom);
  }

  function thumbs() {
    var a = 'width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#3f4540" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"';
    return '<svg ' + a + '><path d="M7 10v11"/><path d="M15 5.9 14 10h5.8a2 2 0 0 1 1.9 2.6l-2.3 7A2 2 0 0 1 17.5 21H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3l4-8a3 3 0 0 1 4 3.9Z"/></svg>' +
      '<svg ' + a + '><path d="M17 14V3"/><path d="M9 18.1 10 14H4.2a2 2 0 0 1-1.9-2.6l2.3-7A2 2 0 0 1 6.5 3H20a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3l-4 8a3 3 0 0 1-4-3.9Z"/></svg>' +
      '<svg ' + a + '><rect x="8" y="8" width="13" height="13" rx="2"/><path d="M4 16a2 2 0 0 1-1-1.7V4a1 1 0 0 1 1-1h10.3A2 2 0 0 1 16 4"/></svg>';
  }

  function replyFor() {
    var n = answerCount();
    if (state.phase === 'preparing') return 'I’m getting your search ready. Answers will appear in the card above as businesses respond.';
    if (state.phase === 'stopped') return n ? 'Your search has stopped. The ' + plural(n, 'answer', 'answers') + ' collected before stopping ' + (n === 1 ? 'is' : 'are') + ' above.' : 'Your search has stopped. You can start again whenever you are ready.';
    if (state.phase === 'complete') return 'The search is complete. ' + plural(n, 'business response is', 'business responses are') + ' above. Some requirements are still not confirmed, so check each response before you decide.';
    if (n === 0) return 'I’m already calling businesses. No answers are available yet, and the other calls continue. Response times depend on when businesses answer.';
    return 'I’m already calling businesses. Answers from ' + (n === 1 ? '1 business are' : n + ' are') + ' available to view while the other calls continue. Response times depend on when businesses answer.';
  }

  /* ---------- Screens ---------- */

  function layoutKey() {
    var r = route();
    if (r !== 'chat') return r;
    if (state.phase === 'complete') return 'chat-complete';
    if (state.phase === 'stopped' && answerCount() > 0) return 'chat-stopped';
    return 'chat-live';
  }

  function chatScreen() {
    var k = layoutKey();
    var top, body;
    if (k === 'chat-live') {
      top = '<div class="top">' + statusBar() + header() + '<div class="card-slot" id="cardSlot">' + statusCard() + '</div></div>';
      body = '<div class="scroll" id="scroll"><div class="thread" id="thread">' + threadHtml() + '</div></div>' + composer(false);
    } else {
      var stopped = k === 'chat-stopped';
      top = '<div class="top top-compact">' + statusBar() + header() + '<div class="card-slot">' + compactBar(stopped ? 'stopped' : 'complete') + '</div></div>';
      body = '<div class="scroll scroll-results" id="scroll">' +
        results(stopped ? 'Answers collected before stopping' : 'Here’s what we found', plural(answerCount(), 'business response', 'business responses')) +
        '<div class="thread" id="thread">' + threadHtml() + '</div></div>' + composer(true);
    }
    return shell('<div class="screen screen-chat">' + top + body + sheetHtml() + '</div>');
  }

  function answersScreen() {
    var top = '<div class="top top-compact">' + statusBar() + header() + '<div class="card-slot">' + compactBar('continues') + '</div></div>';
    var body = '<div class="scroll scroll-results" id="scroll">' + results('Here’s what we found', 'Answers received so far') + '</div>' + composer(true);
    return shell('<div class="screen screen-chat screen-answers">' + top + body + '</div>');
  }

  function ended() { return state.phase === 'complete' || state.phase === 'stopped'; }

  function progressScreen() {
    return shell('<div class="screen screen-progress">' + statusBar() +
      '<div class="lp-head"><button type="button" class="lp-back" data-act="back" aria-label="Back"><span aria-hidden="true">‹</span></button>' +
        '<div><h1 class="lp-title" id="lpTitle">' + (ended() ? 'Search activity' : 'Live progress') + '</h1><p class="lp-sub">Cook for my mother</p></div></div>' +
      '<div class="lp-scroll" id="lpBody">' + progressBody() + '</div>' +
      '<div class="lp-bottom"><button type="button" class="lp-primary" data-act="toChat">Back to conversation</button>' +
        '<p class="lp-foot">Demo activity · Response times depend on businesses</p></div>' +
    '</div>');
  }

  function progressBody() {
    var p = state.phase;
    var s = statuses();
    var c = counts();
    var label = p === 'preparing' ? 'Preparing your search'
      : p === 'complete' ? 'Search complete'
      : p === 'stopped' ? 'Stopped by you' : 'Search in progress';
    var found = s ? '7 businesses found' : 'Finding businesses near Nakoda Nagar';
    var mark = p === 'complete' ? '<span class="lp-mark" aria-hidden="true">' + checkSvg() + '</span>'
      : p === 'stopped' ? '<span class="lp-mark" aria-hidden="true">' + img('stop', 14, 14) + '</span>'
      : '<span class="lp-dot" aria-hidden="true"></span>';

    var html = '<section class="lp-card lp-summary"><p class="lp-label">' + mark + label + '</p><p class="lp-found">' + found + '</p></section>';

    if (!s) {
      html += '<h2 class="lp-h">Calling businesses</h2><p class="lp-meta">' + (p === 'stopped' ? 'No calls were made' : 'Calls have not started yet') + '</p>';
      html += '<section class="lp-card lp-list"><p class="lp-note">' + (p === 'stopped' ? 'No business answers were received.' : 'Answers appear in your conversation as they arrive.') + '</p></section>';
      return html + reviewCard();
    }

    var called = BUSINESSES.filter(function (b) { return ['q', 'sq'].indexOf(s[b.id]) < 0; }).length;
    var reached = c.x + c.a + c.sc;   // a call cut off by stopping was still connected
    var heading, meta;
    if (ended()) {
      heading = p === 'complete' ? 'Calls finished' : 'Calls stopped';
      meta = called + ' called · ' + reached + ' reached · ' + plural(c.a, 'answer', 'answers');
    } else {
      heading = 'Calling businesses';
      meta = callLine(c, true);
    }
    html += '<h2 class="lp-h">' + heading + '</h2><p class="lp-meta">' + meta + '</p>';

    var rows = [];
    BUSINESSES.forEach(function (b) {
      var st = s[b.id];
      var t = {
        x: 'Call ended · Price and availability unconfirmed',
        a: 'Call ended · Answer received',
        n: 'No answer · The call was not picked up',
        c: 'On a call · Checking your requirements',
        sc: 'Stopped · A call was under way when you stopped'
      }[st];
      if (t) rows.push('<li class="lp-row' + (st === 'c' ? ' is-live' : '') + '"><p class="lp-name">' + esc(b.name) + '</p><p class="lp-st">' + esc(t) + '</p></li>');
    });
    if (c.r) rows.push('<li class="lp-row"><p class="lp-name">' + plural(c.r, 'nearby business', 'nearby businesses') + '</p><p class="lp-st">Ringing · Waiting for someone to answer</p></li>');
    if (c.q) rows.push('<li class="lp-row"><p class="lp-name">' + plural(c.q, 'more business', 'more businesses') + '</p><p class="lp-st">Queued · Calls have not started yet</p></li>');
    if (c.sr) rows.push('<li class="lp-row"><p class="lp-name">' + plural(c.sr, 'nearby business', 'nearby businesses') + '</p><p class="lp-st">Stopped · Ringing, not answered</p></li>');
    if (c.sq) rows.push('<li class="lp-row"><p class="lp-name">' + plural(c.sq, 'more business', 'more businesses') + '</p><p class="lp-st">Not called</p></li>');

    var note = !ended() ? 'Answers appear in your conversation as they arrive.'
      : c.a ? 'Answers are in your conversation.' : 'No business answers were received.';
    html += '<section class="lp-card lp-list"><ul>' + rows.join('') + '</ul><p class="lp-note">' + note + '</p></section>';
    return html + reviewCard();
  }

  function reviewCard() {
    var p = state.phase;
    if (p === 'stopped') return '';
    var t = p === 'complete' ? 'Responses reviewed' : 'Reviewing responses';
    var d = p === 'complete' ? 'Each response marks which details were confirmed and which were not.' : 'Options are compared as businesses answer.';
    return '<section class="lp-card lp-review"><h2 class="lp-rt">' + t + '</h2><p class="lp-rd">' + d + '</p></section>';
  }

  function sheetHtml() {
    if (!state.sheet) return '';
    return '<div class="scrim" data-act="keep"></div>' +
      '<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="sheetTitle" aria-describedby="sheetBody">' +
        '<span class="sheet-grab" aria-hidden="true"></span>' +
        '<h2 class="sheet-title" id="sheetTitle">Stop this search?</h2>' +
        '<p class="sheet-body" id="sheetBody">You can still view any answers collected so far.</p>' +
        '<div class="sheet-actions"><button type="button" class="btn-ghost" data-act="keep">Keep searching</button>' +
          '<button type="button" class="btn-dark" data-act="confirmStop">Stop search</button></div>' +
      '</div>';
  }

  /* ---------- Render ---------- */

  var renderedKey = null;

  function update(force) {
    var r = route();

    if (r !== 'intro' && !state.started) startSearch();
    // The answers view only exists while a search is running and has answers.
    if (r === 'answers' && (state.phase !== 'running' || answerCount() === 0)) { go('chat'); return; }
    if (r !== 'chat') state.sheet = false;

    var key = layoutKey() + (state.sheet ? '+sheet' : '');
    if (!force && key === renderedKey) { patch(); return; }

    var scroll = document.getElementById('scroll');
    var sameLayout = renderedKey && renderedKey.split('+')[0] === layoutKey();
    var keepScroll = scroll && sameLayout ? scroll.scrollTop : null;
    var input = document.getElementById('msg');
    var draft = input ? input.value : '';
    var hadFocus = input && document.activeElement === input;

    document.body.className = r === 'intro' ? 'is-intro' : 'is-app';
    root.innerHTML = r === 'intro' ? introView()
      : r === 'progress' ? progressScreen()
      : r === 'answers' ? answersScreen() : chatScreen();
    var prevLayout = renderedKey && renderedKey.split('+')[0];
    renderedKey = key;
    fitDevice();
    if (prevLayout && prevLayout !== layoutKey() && !reduceMotion.matches) {
      var screen = root.querySelector('.screen');
      if (screen) screen.classList.add(r === 'chat' && (prevLayout === 'progress' || prevLayout === 'answers') ? 'enter-back' : 'enter');
    }

    var newInput = document.getElementById('msg');
    if (newInput) { newInput.value = draft; if (hadFocus) newInput.focus(); }
    scroll = document.getElementById('scroll');
    if (scroll) {
      if (keepScroll != null) scroll.scrollTop = keepScroll;
      else if (layoutKey() === 'chat-live') scroll.scrollTop = scroll.scrollHeight;
    }
    if (state.sheet) { var k = root.querySelector('.sheet .btn-ghost'); if (k) k.focus(); }
    if (!sameLayout && r !== 'intro') window.scrollTo(0, 0);
  }

  // Same layout: update only the parts that change, so the composer, focus and scroll stay put.
  function patch() {
    var slot = document.getElementById('cardSlot');
    if (slot) {
      var oldSwap = slot.querySelector('.sc-swap');
      var oldKey = oldSwap && oldSwap.getAttribute('data-swap');
      var focused = slot.contains(document.activeElement) ? document.activeElement.getAttribute('data-act') : null;
      var oldH = slot.offsetHeight;
      slot.innerHTML = statusCard();
      animateHeight(slot, oldH);
      var swap = slot.querySelector('.sc-swap');
      if (swap && oldKey !== swap.getAttribute('data-swap') && !reduceMotion.matches) swap.classList.add('is-new');
      if (focused) focusAct(focused);
    }
    var lp = document.getElementById('lpBody');
    if (lp) {
      var st = lp.scrollTop;
      lp.innerHTML = progressBody();
      lp.scrollTop = st;
      document.getElementById('lpTitle').textContent = ended() ? 'Search activity' : 'Live progress';
    }
    var thread = document.getElementById('thread');
    if (thread) {
      var scroll = document.getElementById('scroll');
      var atBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40;
      var before = thread.childElementCount;
      thread.innerHTML = threadHtml();
      if (!reduceMotion.matches) {
        for (var i = before; i < thread.children.length; i++) thread.children[i].classList.add('msg-in');
      }
      if (thread.childElementCount !== before && (atBottom || follow)) {
        scroll.scrollTo({ top: scroll.scrollHeight, behavior: reduceMotion.matches ? 'auto' : 'smooth' });
      }
      follow = false;
    }
  }

  var follow = false;

  // Animate the pinned card between its old and new height so the chat below moves smoothly.
  function animateHeight(el, from) {
    var to = el.offsetHeight;
    if (reduceMotion.matches || Math.abs(to - from) < 2) return;
    el.style.height = from + 'px';
    el.style.overflow = 'hidden';
    void el.offsetHeight;
    el.style.transition = 'height .36s cubic-bezier(.2, .8, .2, 1)';
    el.style.height = to + 'px';
    var done = function () { el.style.height = el.style.overflow = el.style.transition = ''; el.removeEventListener('transitionend', done); };
    el.addEventListener('transitionend', done);
    setTimeout(done, 450);
  }

  // Keep the phone at its true 390 × 844 and scale the whole device to fit the window.
  function fitDevice() {
    var dev = document.getElementById('device');
    if (!dev) return;
    if (window.innerWidth <= 480) { dev.style.zoom = ''; return; }
    var bar = root.querySelector('.stage-bar'), foot = root.querySelector('.stage-foot');
    var chrome = (bar ? bar.offsetHeight : 0) + (foot ? foot.offsetHeight : 0) + 56;
    var fit = Math.min(1, (window.innerHeight - chrome) / 868, (window.innerWidth - 32) / 414);
    dev.style.zoom = Math.max(fit, .55).toFixed(3);
  }
  window.addEventListener('resize', fitDevice);

  /* ---------- Events ---------- */

  function focusAct(act) {
    var f = root.querySelector('[data-act="' + act + '"]');
    if (f) f.focus();
  }

  root.addEventListener('click', function (e) {
    var el = e.target.closest('[data-act]');
    if (!el) return;
    var act = el.getAttribute('data-act');
    if (act === 'restart') restartSearch('Demo restarted.');
    else if (act === 'again') restartSearch('Search started again.');
    else if (act === 'stop') { state.sheet = true; update(); }
    else if (act === 'keep') { state.sheet = false; update(); focusAct('stop'); }
    else if (act === 'confirmStop') stopSearch();
    else if (act === 'answers') go('answers');
    else if (act === 'chat' || act === 'toChat') go('chat');
    else if (act === 'progress') { state.prev = route() === 'answers' ? 'answers' : 'chat'; go('progress'); }
    else if (act === 'back') go(state.prev);
  });

  root.addEventListener('submit', function (e) {
    var form = e.target.closest('[data-form="msg"]');
    if (!form) return;
    e.preventDefault();
    var input = form.querySelector('input');
    var text = input.value.trim();
    if (!text) return;
    input.value = '';
    if (layoutKey() !== 'chat-live' && layoutKey() !== 'answers' && state.resultsFrom == null) state.resultsFrom = state.messages.length;
    state.messages.push({ from: 'user', text: text });
    follow = true;
    if (route() === 'answers') go('chat'); else update();
    var session = state;
    setTimeout(function () {
      if (state !== session) return;
      state.messages.push({ from: 'aurora', text: replyFor(), time: nowTime() });
      follow = true;
      if (route() === 'chat') update();
    }, 700);
  });

  document.addEventListener('keydown', function (e) {
    if (!state.sheet) return;
    if (e.key === 'Escape') { state.sheet = false; update(); focusAct('stop'); }
    if (e.key === 'Tab') {
      var btns = root.querySelectorAll('.sheet button');
      var first = btns[0], last = btns[btns.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
  });

  state = freshState();
  update(true);
})();
