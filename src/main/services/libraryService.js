/**
 * Libraries: search the index, install, list what is installed, and work out
 * which library provides a header the compiler could not find.
 *
 * The library index says which headers each library provides
 * (`provides_includes`), so a failed compile naming `Adafruit_SSD1306.h` can be
 * answered with the library that has it instead of a guess. That is also how
 * the agent checks a library exists before recommending it.
 * @module main/services/libraryService
 */

const INDEX_TTL_MS = 6 * 60 * 60 * 1000;
const INSTALLED_TTL_MS = 30 * 1000;

/** "fatal error: Adafruit_SSD1306.h: No such file or directory" → the header. */
const MISSING_HEADER = /fatal error:\s*([A-Za-z0-9_./+-]+\.h(?:pp)?):\s*No such file or directory/g;

/** Headers a sketch includes, in order, without repeats. */
function includesOf(code) {
  const out = [];
  for (const m of String(code || '').matchAll(/^\s*#\s*include\s*[<"]([^>"]+)[>"]/gm)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

/** Every header the compiler said it could not find, in order, without repeats. */
function missingHeadersOf(output) {
  const out = [];
  for (const m of String(output || '').matchAll(MISSING_HEADER)) {
    const header = m[1].split('/').pop();
    if (!out.includes(header)) out.push(header);
  }
  return out;
}

const lower = (v) => String(v || '').toLowerCase();

class LibraryService {
  /** @param {(args: string[], opts?: object) => Promise<{ success: boolean, stdout: string, stderr: string }>} runCli */
  constructor(runCli) {
    this.runCli = runCli;
    this._index = { at: 0, libraries: [] };
    this._installed = { at: 0, libraries: [] };
  }

  async _json(args, timeout = 60000) {
    const res = await this.runCli([...args, '--format', 'json'], { timeout });
    if (!res?.success) throw new Error((res?.stderr || res?.stdout || 'arduino-cli failed').trim().split('\n').pop());
    try {
      return JSON.parse(res.stdout || '{}');
    } catch {
      throw new Error('arduino-cli returned something that is not JSON');
    }
  }

  /**
   * The whole library index, cached. Each entry: name, latest version, what it
   * is for, and the headers it provides.
   */
  async index({ refresh = false } = {}) {
    if (!refresh && this._index.libraries.length && Date.now() - this._index.at < INDEX_TTL_MS) return this._index.libraries;
    if (refresh) await this.runCli(['lib', 'update-index'], { timeout: 120000 }).catch(() => null);
    let data;
    try {
      data = await this._json(['lib', 'search'], 120000);
    } catch (error) {
      // No index yet (first run, or offline): update once, then give up quietly.
      if (!this._index.libraries.length && !refresh) {
        await this.runCli(['lib', 'update-index'], { timeout: 120000 }).catch(() => null);
        data = await this._json(['lib', 'search'], 120000).catch(() => null);
      }
      if (!data) throw error;
    }
    const libraries = (data.libraries || []).map((lib) => {
      const releases = lib.releases || {};
      const latest = lib.latest || releases[lib.latest_version] || Object.values(releases).pop() || {};
      return {
        name: lib.name,
        version: latest.version || lib.latest_version || '',
        author: latest.author || '',
        sentence: latest.sentence || '',
        paragraph: latest.paragraph || '',
        website: latest.website || '',
        category: latest.category || '',
        architectures: latest.architectures || [],
        provides: latest.provides_includes || [],
        versions: Object.keys(releases),
      };
    });
    this._index = { at: Date.now(), libraries };
    return libraries;
  }

  /** Installed libraries (name, version, the headers they provide). */
  async installed({ refresh = false } = {}) {
    if (!refresh && this._installed.libraries.length && Date.now() - this._installed.at < INSTALLED_TTL_MS) return this._installed.libraries;
    const data = await this._json(['lib', 'list'], 60000);
    const libraries = (data.installed_libraries || []).map((entry) => {
      const lib = entry.library || entry;
      return {
        name: lib.name,
        version: lib.version || '',
        location: lib.location || '',
        provides: lib.provides_includes || [],
        sentence: lib.sentence || '',
        architectures: lib.architectures || [],
      };
    });
    this._installed = { at: Date.now(), libraries };
    return libraries;
  }

  /** Forget the installed list (after an install or uninstall). */
  invalidate() {
    this._installed = { at: 0, libraries: [] };
  }

  /**
   * Libraries matching a query, best first: an exact name, then a header it
   * provides, then words in the name, then the description.
   * @returns {Promise<Array<object>>}
   */
  async search(query, { limit = 20, fqbn = '' } = {}) {
    const q = lower(query).trim();
    const libraries = await this.index();
    const installed = new Map((await this.installed().catch(() => [])).map((l) => [lower(l.name), l]));
    const arch = String(fqbn || '').split(':')[1] || '';
    const score = (lib) => {
      const name = lower(lib.name);
      if (!q) return 1;
      if (name === q) return 100;
      if (lib.provides.some((h) => lower(h) === q || lower(h) === `${q}.h`)) return 90;
      if (name.startsWith(q)) return 70;
      if (name.includes(q)) return 50;
      if (lower(lib.sentence).includes(q)) return 20;
      if (lower(lib.paragraph).includes(q)) return 10;
      return 0;
    };
    return libraries
      .map((lib) => ({ lib, s: score(lib) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.lib.name.localeCompare(b.lib.name))
      .slice(0, limit)
      .map(({ lib }) => ({
        ...lib,
        installed: installed.has(lower(lib.name)),
        installedVersion: installed.get(lower(lib.name))?.version || null,
        // A library that names architectures and not this one may still compile, so this is a note, not a filter.
        fitsBoard: !arch || !lib.architectures.length || lib.architectures.includes('*') || lib.architectures.includes(arch),
      }));
  }

  /** The library that provides a header, best first (installed ones first). */
  async providersOf(header, { fqbn = '' } = {}) {
    const want = lower(header);
    const bare = want.replace(/\.(h|hpp)$/, '');
    const arch = String(fqbn || '').split(':')[1] || '';
    const libraries = await this.index();
    const installed = new Set((await this.installed().catch(() => [])).map((l) => lower(l.name)));
    const squash = (v) => lower(v).replace(/[^a-z0-9]/g, '');
    const hits = libraries.filter((lib) => lib.provides.some((h) => lower(h) === want) || lower(lib.name) === bare);
    return hits
      .map((lib) => ({
        ...lib,
        installed: installed.has(lower(lib.name)),
        exactHeader: lib.provides.some((h) => lower(h) === want),
        fitsBoard: !arch || !lib.architectures.length || lib.architectures.includes('*') || lib.architectures.includes(arch),
        // A library named like the header is the one the header belongs to
        // (DHT.h → "DHT sensor library" before a library that merely ships a copy).
        nameMatch: squash(lib.name) === squash(bare) ? 2 : squash(lib.name).startsWith(squash(bare)) ? 1 : 0,
      }))
      .sort((a, b) => Number(b.exactHeader) - Number(a.exactHeader)
        || Number(b.fitsBoard) - Number(a.fitsBoard)
        || b.nameMatch - a.nameMatch
        || a.name.length - b.name.length
        || a.name.localeCompare(b.name));
  }

  /**
   * Install a library by name (and optional version).
   * @param {string} name
   * @param {{ version?: string, onOutput?: (line: string) => void }} [opts]
   */
  async install(name, { version = '', onOutput } = {}) {
    if (!name || !/^[\w .+-]{1,120}$/.test(name)) throw new Error(`"${name}" is not a library name.`);
    if (version && !/^[\w.-]{1,40}$/.test(version)) throw new Error(`"${version}" is not a version.`);
    const spec = version ? `${name}@${version}` : name;
    const res = await this.runCli(['lib', 'install', spec], { timeout: 300000, onOutput });
    if (!res?.success) {
      const message = (res?.stderr || res?.stdout || '').trim().split('\n').pop() || 'the install failed';
      throw new Error(`Could not install ${spec}: ${message}`);
    }
    this.invalidate();
    return { name, version: version || null, output: `${res.stdout || ''}${res.stderr || ''}`.trim() };
  }

  async uninstall(name) {
    if (!name || !/^[\w .+-]{1,120}$/.test(name)) throw new Error(`"${name}" is not a library name.`);
    const res = await this.runCli(['lib', 'uninstall', name], { timeout: 120000 });
    if (!res?.success) throw new Error((res?.stderr || res?.stdout || 'the uninstall failed').trim().split('\n').pop());
    this.invalidate();
    return { name };
  }

  /**
   * Which headers of a sketch no installed library provides, and what would
   * provide them. Headers the board's own core provides are not listed: a
   * compile is what proves those, so this only reports what the index knows.
   * @param {string} code
   * @param {{ fqbn?: string }} [opts]
   */
  async missingFor(code, { fqbn = '' } = {}) {
    const headers = includesOf(code);
    if (!headers.length) return [];
    const installed = await this.installed().catch(() => []);
    const provided = new Set(installed.flatMap((l) => l.provides.map(lower)));
    const out = [];
    for (const header of headers) {
      const base = header.split('/').pop();
      if (provided.has(lower(base)) || provided.has(lower(header))) continue;
      const providers = await this.providersOf(base, { fqbn }).catch(() => []);
      // Nothing in the index provides it: it is the core's own header (Wire.h,
      // WiFi.h on an ESP32) or a file of the sketch, so there is nothing to install.
      if (!providers.length || providers[0].installed) continue;
      out.push({ header: base, suggestion: providers[0], alternatives: providers.slice(1, 4) });
    }
    return out;
  }

  /**
   * A compile failed on missing headers: install what provides them.
   * @param {string} output  the build output
   * @param {{ fqbn?: string, max?: number, onOutput?: (line: string) => void }} [opts]
   * @returns {Promise<{ installed: object[], unresolved: string[] }>}
   */
  async installForMissingHeaders(output, { fqbn = '', max = 3, onOutput } = {}) {
    const headers = missingHeadersOf(output).slice(0, max);
    const installed = [];
    const unresolved = [];
    for (const header of headers) {
      const providers = await this.providersOf(header, { fqbn }).catch(() => []);
      const pick = providers.find((p) => !p.installed);
      if (!pick) {
        unresolved.push(header);
        continue;
      }
      try {
        await this.install(pick.name, { onOutput });
        installed.push({ header, name: pick.name, version: pick.version });
      } catch (error) {
        unresolved.push(`${header} (${error.message})`);
      }
    }
    return { installed, unresolved };
  }
}

module.exports = { LibraryService, includesOf, missingHeadersOf };
