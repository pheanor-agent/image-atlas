'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasBrowse = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const AXES = ['subject', 'style', 'situation', 'activity', 'place', 'composition', 'mood', 'lighting'];

  function facetMatches(item, selections, parentsByAxis = {}) {
    return [...selections].every(([axis, values]) => {
      if (!values || !values.size) return true;
      const own = new Set(item.semantic?.[axis] || []), parents = parentsByAxis[axis] || {};
      for (const id of [...own]) {
        const seen = new Set();
        for (let parent = parents[id]; parent && !seen.has(parent); parent = parents[parent]) {
          seen.add(parent); own.add(parent);
        }
      }
      return [...values].some(value => own.has(value));
    });
  }
  function applyFacets(items, selections, parentsByAxis = {}) { return items.filter(item => facetMatches(item, selections, parentsByAxis)); }
  function buildTree(labels = {}, parents = {}, counts = new Map()) {
    const nodes = new Map(Object.entries(labels).map(([id, label]) => [id, { id, label, count: counts.get(id) || 0, children: [] }]));
    const roots = [];
    for (const entry of nodes.values()) {
      const parent = nodes.get(parents[entry.id]);
      if (parent && parent.id !== entry.id) parent.children.push(entry); else roots.push(entry);
    }
    const sort = list => { list.sort((a, b) => a.label.localeCompare(b.label, 'ko')); list.forEach(entry => sort(entry.children)); };
    sort(roots);
    return roots;
  }
  function countNodes(items, axis, parents = {}) {
    const direct = new Map(), unique = new Map();
    for (const item of items) {
      const ids = new Set(item.semantic?.[axis] || []);
      for (const id of ids) direct.set(id, (direct.get(id) || 0) + 1);
      for (const id of ids) {
        const seen = new Set();
        for (let current = id; current && !seen.has(current); current = parents[current]) {
          seen.add(current); if (!unique.has(current)) unique.set(current, new Set()); unique.get(current).add(item.image_id ?? item);
        }
      }
    }
    return { direct, unique: new Map([...unique].map(([id, set]) => [id, set.size])) };
  }
  function normalizePhrase(value) {
    return String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[_-]+/g, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim().replace(/\s+/g, ' ');
  }
  function interpretQuery(query, vocabulary, labels = {}, parentsByAxis = {}) {
    const normalized = normalizePhrase(query);
    if (/(?:\b(?:no|not|without|avoid|exclude|excluding)\b|없(?:는|음|다)|아닌|아니다|제외|빼고|말고|않(?:는|은))/iu.test(normalized)) {
      return { matches: new Map(), unresolved: normalized, recognized: 0, unsupportedNegation: true };
    }
    const groups = Array.isArray(vocabulary)
      ? vocabulary.map(entry => [entry.axis, { [entry.id]: entry }])
      : Object.entries(vocabulary || {});
    const phrases = groups.flatMap(([axis, entries]) =>
      Object.entries(entries || {}).flatMap(([id, entry]) => {
        const aliases = Array.isArray(entry) ? entry : typeof entry === 'string' ? [entry] : [entry?.label, ...(entry?.aliases || [])];
        return [id, labels?.[axis]?.[id], ...aliases].flatMap(alias => {
          const value = typeof alias === 'object' && alias ? alias.phrase || alias.alias || alias.label : alias;
          const phrase = normalizePhrase(value);
          return phrase ? [{ axis: entry.axis || axis, id: entry.id || id, phrase }] : [];
        });
      })).sort((a, b) => b.phrase.length - a.phrase.length);
    const original = ` ${normalized} `;
    let remaining = original;
    const matches = new Map();
    for (const entry of phrases) {
      const escaped = entry.phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const korean = /\p{Script=Hangul}/u.test(entry.phrase);
      const particles = korean ? '(?:에서부터|에서만|에서의|에서|으로|로부터|에게서|에게|은|는|이|가|을|를|에|와|과|로|의|만|한)?' : '(?:es|s)?';
      const pattern = new RegExp(`(^| )${escaped}${particles}(?= |$)`, 'u');
      if (!pattern.test(original)) continue;
      const match = pattern.exec(remaining);
      if (!matches.has(entry.axis)) matches.set(entry.axis, new Set());
      matches.get(entry.axis).add(entry.id);
      if (match) remaining = remaining.slice(0, match.index) + ' ' + remaining.slice(match.index + match[0].length);
    }
    // A longer phrase may contain an entity on another axis (reading a book).
    // Keep that entity, while removing redundant broad ancestors of specific terms.
    for (const [axis, ids] of matches) for (const id of [...ids]) {
      const seen = new Set();
      for (let parent = parentsByAxis[axis]?.[id]; parent && !seen.has(parent); parent = parentsByAxis[axis]?.[parent]) {
        seen.add(parent); ids.delete(parent);
      }
    }
    const unresolved = remaining.trim();
    return { matches, unresolved, recognized: [...matches.values()].reduce((n, set) => n + set.size, 0) };
  }
  function contentMatches(item, interpretation) {
    if (interpretation.unresolved) return false;
    if (!interpretation.recognized) return false;
    return facetMatches(item, interpretation.matches);
  }
  function toggleExpanded(expanded, id) {
    const next = new Set(expanded);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }
  function toggleSelection(selections, axis, id) {
    const next = new Map([...selections].map(([key, values]) => [key, new Set(values)]));
    const values = next.get(axis) || new Set();
    if (values.has(id)) values.delete(id); else values.add(id);
    if (values.size) next.set(axis, values); else next.delete(axis);
    return next;
  }
  function writeSelectionParams(params, selections) {
    for (const axis of AXES) {
      params.delete(axis);
      for (const value of selections.get(axis) || []) params.append(axis, value);
    }
    return params;
  }
  function readSelectionParams(params, validIds = {}) {
    const selections = new Map();
    for (const axis of AXES) {
      const valid = validIds[axis] ? new Set(validIds[axis]) : null;
      const values = params.getAll(axis).filter(value => !valid || valid.has(value));
      if (values.length) selections.set(axis, new Set(values));
    }
    return selections;
  }
  return { AXES, applyFacets, buildTree, countNodes, normalizePhrase, interpretQuery, contentMatches, toggleExpanded, toggleSelection, writeSelectionParams, readSelectionParams };
});
