// The empty-state background: a field of firmware hex (Intel HEX records,
// what gets flashed to a board) lit by slowly drifting light, with a signal
// pulse sweeping across now and then, and a ripple of glow that runs out from
// wherever you click. It only runs before the first message.
//
// WebGL2, two passes so it stays cheap at full resolution: pass 1 works out
// each character cell's brightness and glyph into a small texture (one texel
// per cell); pass 2 draws every pixel from that texture and a glyph atlas.
// 30 fps, paused while the window is hidden, one still frame under reduced
// motion, and a one-off 2D drawing where WebGL2 isn't available.

const GLYPHS = '0123456789ABCDEF:';
const FONT_PX = 12.5;
const LINE_PX = 15;
const FRAME_MS = 1000 / 30;
/** Ripples drawn at once, and how long one lives (seconds). */
const MAX_RIPPLES = 6;
const RIPPLE_LIFE_S = 5;

const VERT = `#version 300 es
in vec2 a_pos;
void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }`;

// Pass 1: one fragment per cell. R = brightness, G = glyph, B = 1 when the cell has a glyph.
const FIELD_FRAG = `#version 300 es
precision highp float;
uniform vec2 u_res;
uniform vec2 u_cell;
uniform float u_time;
uniform vec2 u_mouse;
uniform vec2 u_focus;
uniform vec2 u_focusR;
uniform float u_dpr;
// Click ripples: x, y in GL pixels and the age in seconds (negative: unused).
uniform vec3 u_ripple[6];
out vec4 o;

float h21(vec2 p) { p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(h31(i), h31(i + vec3(1, 0, 0)), f.x), mix(h31(i + vec3(0, 1, 0)), h31(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(h31(i + vec3(0, 0, 1)), h31(i + vec3(1, 0, 1)), f.x), mix(h31(i + vec3(0, 1, 1)), h31(i + vec3(1, 1, 1)), f.x), f.y),
    f.z);
}
float fbm(vec3 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * vnoise(p); p = p * 2.03 + 11.7; a *= 0.5; }
  return v;
}

void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 c = (cell + 0.5) * u_cell;

  // Intel HEX: ':' + 42 hex digits, a gap, the next record; rows start at random offsets.
  float pos = mod(cell.x + floor(h21(vec2(cell.y, 7.0)) * 44.0), 44.0);
  float visible = pos > 42.5 ? 0.0 : 1.0;
  float glyph = 16.0;
  if (pos > 0.5) {
    float s1 = h21(cell + 0.37);
    float s2 = h21(cell + 1.91);
    float k = floor(u_time * (0.35 + 0.8 * s1) + s2 * 13.0);
    glyph = floor(h21(cell + vec2(17.0, 29.0) * k) * 16.0);
  }

  // Drifting light: two soft lights wander the field on slow Lissajous paths,
  // and domain-warped noise breaks what they light into swaths.
  vec2 q = c / (760.0 * u_dpr);
  float t = u_time * 0.055;
  vec3 p = vec3(q, t);
  vec2 warp = vec2(fbm(p), fbm(p + vec3(5.2, 1.3, 2.8))) - 0.47;
  float n = fbm(vec3(q + 1.8 * warp, t * 1.25));
  vec2 uv = c / u_res;
  vec2 aspect = vec2(u_res.x / u_res.y, 1.0);
  float lt = u_time * 0.07;
  vec2 l1 = vec2(0.5 + 0.40 * sin(lt * 0.9), 0.5 + 0.34 * sin(lt * 1.3 + 1.0));
  vec2 l2 = vec2(0.5 + 0.42 * cos(lt * 0.7 + 2.0), 0.5 + 0.36 * sin(lt * 0.55 + 4.0));
  vec2 d1 = (uv - l1) * aspect;
  vec2 d2 = (uv - l2) * aspect;
  float light = max(exp(-dot(d1, d1) / 0.11), 0.85 * exp(-dot(d2, d2) / 0.08));
  float b = 0.6 * light * smoothstep(0.40, 0.60, n);

  // The impulse: every 16 s a narrow band sweeps across in about 3 s.
  float ph = mod(u_time, 16.0);
  if (ph < 3.2) {
    float s = (c.x / u_res.x) * 0.86 + (1.0 - c.y / u_res.y) * 0.14;
    float d = (s - (ph / 3.2 * 1.4 - 0.2)) / 0.02;
    float band = exp(-d * d) * smoothstep(0.0, 0.4, ph) * (1.0 - smoothstep(2.8, 3.2, ph));
    b = max(b, band * (0.5 + 0.5 * h21(cell + 3.3)));
  }

  // A little light follows the pointer.
  if (u_mouse.x >= 0.0) {
    vec2 dm = (c - u_mouse) / (170.0 * u_dpr);
    b += 0.32 * exp(-dot(dm, dm));
  }

  // Calm behind the headline and cards so text stays readable.
  vec2 fd = (c - u_focus) / max(u_focusR, vec2(1.0));
  float calm = smoothstep(0.78, 1.3, length(fd));
  b *= mix(0.2, 1.0, calm);

  // Click ripples: a ring of lit characters runs out from the click, grainy
  // character by character, with a glow that trails behind the front and
  // keeps flowing for a few seconds before it fades.
  float grain = 0.7 + 0.6 * h21(cell + 5.7);
  float rb = 0.0;
  for (int i = 0; i < 6; i++) {
    float age = u_ripple[i].z;
    if (age < 0.0) continue;
    vec2 dr = (c - u_ripple[i].xy) / u_dpr;
    float dist = length(dr);
    // The front wobbles so it reads as flowing light, not a compass circle.
    float wob = (fbm(vec3(dr / 240.0, age * 0.8 + float(i) * 7.3)) - 0.5) * 200.0;
    // Fast at first, then slowing as it nears the edges, so the light lingers.
    float R = 1100.0 * (1.0 - exp(-age / 0.9));
    float W = 110.0 + 70.0 * age;
    float d = dist + wob;
    // The wave: a bright front, and a band of light behind it that widens as
    // it ages and ends, so the field flows rather than fills.
    float front = exp(-pow((d - R) / W, 2.0));
    float L = 260.0 + 220.0 * age;
    float tail = smoothstep(R + W, R - W, d) * exp(-pow(max(0.0, R - d) / L, 2.0));
    float cloud = 0.55 + 0.7 * smoothstep(0.35, 0.65, fbm(vec3(dr / 380.0 + float(i), age * 0.5)));
    float life = 1.0 - smoothstep(3.0, 5.0, age);
    rb = max(rb, (front * 1.7 + tail * 1.0) * cloud * life);
  }
  // Ripples pass behind the text dimmed, not hidden.
  b = max(b, rb * grain * mix(0.6, 1.0, calm));

  o = vec4(clamp(b, 0.0, 1.0), (glyph + 0.5) / 32.0, visible, 1.0);
}`;

// Pass 2: every pixel, from the cell texture and the glyph atlas.
const DRAW_FRAG = `#version 300 es
precision highp float;
uniform sampler2D u_field;
uniform sampler2D u_atlas;
uniform vec2 u_cellPx;
uniform vec3 u_base;
uniform vec3 u_lit;
uniform vec3 u_peak;
uniform float u_baseAlpha;
uniform float u_litAlpha;
out vec4 o;

void main() {
  ivec2 px = ivec2(gl_FragCoord.xy);
  ivec2 cpx = ivec2(u_cellPx);
  ivec2 cell = px / cpx;
  ivec2 local = px - cell * cpx;
  vec4 f = texelFetch(u_field, cell, 0);
  if (f.b < 0.5) { o = vec4(0.0); return; }
  int glyph = int(floor(f.g * 32.0));
  float a = texelFetch(u_atlas, ivec2(glyph * cpx.x + local.x, cpx.y - 1 - local.y), 0).a;
  float b = f.r;
  vec3 color = mix(u_base, u_lit, smoothstep(0.0, 0.3, b));
  color = mix(color, u_peak, smoothstep(0.82, 1.0, b));
  float alpha = a * (u_baseAlpha + u_litAlpha * b);
  o = vec4(color * alpha, alpha);
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader failed: ${log}`);
  }
  return shader;
}

function program(gl, frag) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, frag));
  gl.bindAttribLocation(p, 0, 'a_pos');
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`Link failed: ${gl.getProgramInfoLog(p)}`);
  const uniforms = {};
  const count = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i++) {
    const { name } = gl.getActiveUniform(p, i);
    uniforms[name] = gl.getUniformLocation(p, name);
  }
  return { p, u: uniforms };
}

const rgb = (value, fallback) => {
  const parts = String(value || '').split(',').map((v) => Number(v.trim()) / 255);
  return parts.length === 3 && parts.every((v) => Number.isFinite(v)) ? parts : fallback;
};

export class CharField {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.gl = null;
    this.running = false;
    this.raf = 0;
    this.last = 0;
    this.t0 = performance.now();
    this.pointer = null;
    this.focus = null;
    /** Live click ripples: { x, y } in CSS pixels, t0 in performance.now() ms. */
    this.ripples = [];
    this.rippleData = new Float32Array(MAX_RIPPLES * 3);
    this.reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    this.loop = this.loop.bind(this);
    this.onVisibility = () => (document.hidden ? this.pause() : this.resume());
    this.onLost = (e) => {
      e.preventDefault();
      this.pause();
      this.gl = null;
    };
    this.onRestored = () => {
      this.init();
      this.resume();
    };
    canvas.addEventListener('webglcontextlost', this.onLost);
    canvas.addEventListener('webglcontextrestored', this.onRestored);
    document.addEventListener('visibilitychange', this.onVisibility);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas);
  }

  async init() {
    await document.fonts?.load?.(`400 ${FONT_PX}px "JetBrains Mono Variable"`).catch(() => {});
    const gl = this.canvas.getContext('webgl2', { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false, powerPreference: 'low-power' });
    if (!gl) {
      this.gl = null;
      this.fallback = true;
      this.resize();
      return false;
    }
    this.gl = gl;
    try {
      this.fieldProg = program(gl, FIELD_FRAG);
      this.drawProg = program(gl, DRAW_FRAG);
    } catch (error) {
      console.warn('[chat] background disabled:', error.message);
      this.gl = null;
      this.fallback = true;
      return false;
    }
    const quad = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quad);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    this.fieldTex = gl.createTexture();
    this.atlasTex = gl.createTexture();
    this.fbo = gl.createFramebuffer();
    this.colors();
    this.resize();
    return true;
  }

  /** Read the field colours from the theme tokens. */
  colors() {
    const css = getComputedStyle(document.documentElement);
    const light = document.documentElement.dataset.theme === 'light';
    this.palette = {
      base: rgb(css.getPropertyValue('--v-field-base'), [0.59, 0.64, 0.7]),
      lit: rgb(css.getPropertyValue('--v-field-lit'), [0.3, 0.5, 0.73]),
      peak: rgb(css.getPropertyValue('--v-field-peak'), [0.55, 0.73, 0.93]),
      baseAlpha: light ? 0.07 : 0.04,
      litAlpha: light ? 0.6 : 0.78,
    };
    if (this.fallback) this.drawFallback();
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    const sizeChanged = this.canvas.width !== w || this.canvas.height !== h || this.dpr !== dpr;
    this.canvas.width = w;
    this.canvas.height = h;
    if (this.fallback) {
      this.drawFallback();
      return;
    }
    if (!this.gl || !sizeChanged) return;
    this.dpr = dpr;
    this.buildAtlas(dpr);
    const gl = this.gl;
    this.cols = Math.ceil(w / this.cellPx[0]);
    this.rows = Math.ceil(h / this.cellPx[1]);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, this.cols, this.rows, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fieldTex, 0);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (!this.running) this.frame(performance.now(), true);
  }

  buildAtlas(dpr) {
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `400 ${FONT_PX}px "JetBrains Mono Variable", ui-monospace, monospace`;
    const advance = measure.measureText('0').width || FONT_PX * 0.6;
    const cw = Math.max(4, Math.round(advance * dpr));
    const ch = Math.max(8, Math.round(LINE_PX * dpr));
    this.cellPx = [cw, ch];
    const atlas = document.createElement('canvas');
    atlas.width = cw * GLYPHS.length;
    atlas.height = ch;
    const ctx = atlas.getContext('2d');
    ctx.font = `400 ${FONT_PX * dpr}px "JetBrains Mono Variable", ui-monospace, monospace`;
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    [...GLYPHS].forEach((g, i) => ctx.fillText(g, i * cw + cw / 2, ch / 2 + dpr * 0.5));
    const gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, atlas);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  }

  /** The area to keep calm (the headline and cards), in CSS pixels relative to the canvas. */
  setFocus(rect) {
    this.focus = rect;
  }

  setPointer(x, y) {
    this.pointer = x === null ? null : [x, y];
  }

  /** A click at (x, y) in CSS pixels relative to the canvas: light runs out from there. */
  ripple(x, y) {
    if (this.reduced || this.stopped) return;
    this.ripples.push({ x, y, t0: performance.now() });
    if (this.ripples.length > MAX_RIPPLES) this.ripples.splice(0, this.ripples.length - MAX_RIPPLES);
    this.resume();
  }

  frame(now, force = false) {
    const gl = this.gl;
    if (!gl) return;
    if (!force && now - this.last < FRAME_MS) return;
    this.last = now;
    const t = this.reduced ? 42 : (now - this.t0) / 1000;
    const dpr = this.dpr || 1;
    const w = this.canvas.width;
    const h = this.canvas.height;
    const [cw, ch] = this.cellPx;

    gl.bindVertexArray(this.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
    gl.viewport(0, 0, this.cols, this.rows);
    const f = this.fieldProg;
    gl.useProgram(f.p);
    gl.uniform2f(f.u.u_res, w, h);
    gl.uniform2f(f.u.u_cell, cw, ch);
    gl.uniform1f(f.u.u_time, t);
    gl.uniform1f(f.u.u_dpr, dpr);
    // Pointer and focus in GL pixels (origin bottom-left).
    if (this.pointer && !this.reduced) gl.uniform2f(f.u.u_mouse, this.pointer[0] * dpr, h - this.pointer[1] * dpr);
    else gl.uniform2f(f.u.u_mouse, -1, -1);
    const focus = this.focus || { x: w / dpr / 2, y: h / dpr / 2, rx: 0, ry: 0 };
    gl.uniform2f(f.u.u_focus, focus.x * dpr, h - focus.y * dpr);
    gl.uniform2f(f.u.u_focusR, focus.rx * dpr, focus.ry * dpr);
    // Ripples: position in GL pixels (origin bottom-left) and age; finished ones go.
    this.ripples = this.ripples.filter((r) => now - r.t0 < RIPPLE_LIFE_S * 1000);
    const data = this.rippleData;
    for (let i = 0; i < MAX_RIPPLES; i++) {
      const r = this.ripples[i];
      data[i * 3] = r ? r.x * dpr : 0;
      data[i * 3 + 1] = r ? h - r.y * dpr : 0;
      data[i * 3 + 2] = r ? (now - r.t0) / 1000 : -1;
    }
    gl.uniform3fv(f.u['u_ripple[0]'], data);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, w, h);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const d = this.drawProg;
    gl.useProgram(d.p);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.fieldTex);
    gl.uniform1i(d.u.u_field, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.atlasTex);
    gl.uniform1i(d.u.u_atlas, 1);
    gl.uniform2f(d.u.u_cellPx, cw, ch);
    const pal = this.palette;
    gl.uniform3fv(d.u.u_base, pal.base);
    gl.uniform3fv(d.u.u_lit, pal.lit);
    gl.uniform3fv(d.u.u_peak, pal.peak);
    gl.uniform1f(d.u.u_baseAlpha, pal.baseAlpha);
    gl.uniform1f(d.u.u_litAlpha, pal.litAlpha);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  loop(now) {
    if (!this.running) return;
    this.frame(now);
    this.raf = requestAnimationFrame(this.loop);
  }

  async start() {
    if (!this.gl && !this.fallback) await this.init();
    if (this.fallback) return;
    if (this.reduced) {
      this.frame(performance.now(), true);
      return;
    }
    this.resume();
  }

  resume() {
    if (this.running || !this.gl || this.reduced || this.stopped || document.hidden) return;
    this.running = true;
    this.raf = requestAnimationFrame(this.loop);
  }

  pause() {
    this.running = false;
    cancelAnimationFrame(this.raf);
  }

  /** Stop for good (until start() again): the chat has begun. */
  stop() {
    this.stopped = true;
    this.pause();
  }

  restart() {
    this.stopped = false;
    this.start();
  }

  /** WebGL2 missing: draw the field once with the 2D canvas. */
  drawFallback() {
    const ctx = this.canvas.getContext('2d');
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.clearRect(0, 0, w, h);
    ctx.font = `400 ${FONT_PX * dpr}px "JetBrains Mono Variable", ui-monospace, monospace`;
    ctx.textBaseline = 'top';
    const cw = (ctx.measureText('0').width || FONT_PX * 0.6 * dpr);
    const ch = LINE_PX * dpr;
    const pal = this.palette || { base: [0.59, 0.64, 0.7], lit: [0.3, 0.5, 0.73] };
    const toCss = (c, a) => `rgba(${Math.round(c[0] * 255)},${Math.round(c[1] * 255)},${Math.round(c[2] * 255)},${a})`;
    let seed = 7;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let y = 0, row = 0; y < h; y += ch, row++) {
      for (let x = 0, col = 0; x < w; x += cw, col++) {
        const pos = (col + row * 13) % 44;
        if (pos === 43) continue;
        const g = pos === 0 ? ':' : GLYPHS[Math.floor(rand() * 16)];
        const glow = Math.max(0, Math.sin(x / (w * 0.21) + row * 0.07) * Math.cos(y / (h * 0.33)) - 0.35);
        ctx.fillStyle = glow > 0 ? toCss(pal.lit, Math.min(0.5, 0.08 + glow)) : toCss(pal.base, 0.07);
        ctx.fillText(g, x, y);
      }
    }
  }

  destroy() {
    this.stop();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.canvas.removeEventListener('webglcontextlost', this.onLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onRestored);
  }
}
