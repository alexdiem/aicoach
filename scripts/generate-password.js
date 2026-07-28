#!/usr/bin/env node
// Generates the two env vars server/auth.js needs: APP_PASSWORD (what you
// type in at /login.html) and SESSION_SECRET (signs the session cookie —
// never the password itself, so rotating this alone invalidates every
// outstanding session without changing the password).
//
// Run again any time to rotate: a new APP_PASSWORD changes what you type in,
// a new SESSION_SECRET immediately invalidates all previously issued cookies.

import { randomInt, randomBytes } from 'node:crypto';

// Short, common, unambiguous-to-type words — memorable over the phone or
// typed on a phone keyboard, and distinct enough not to be confused for one
// another (no near-homophones, no words that differ by one easily-mistyped
// letter).
const WORDS = [
  'anchor', 'arrow', 'autumn', 'basil', 'beacon', 'birch', 'blossom', 'boulder',
  'bramble', 'breeze', 'canyon', 'cedar', 'clover', 'comet', 'copper', 'coral',
  'cotton', 'crater', 'crescent', 'cricket', 'crimson', 'crystal', 'daisy', 'dawn',
  'delta', 'desert', 'dune', 'ember', 'falcon', 'feather', 'fern', 'fjord',
  'flint', 'forest', 'fox', 'garnet', 'glacier', 'granite', 'gravel', 'hallow',
  'harbor', 'hazel', 'heron', 'hickory', 'hollow', 'horizon', 'indigo', 'ivory',
  'jasper', 'juniper', 'lagoon', 'lantern', 'laurel', 'ledge', 'lichen', 'lilac',
  'linen', 'lotus', 'lumber', 'lynx', 'magnet', 'maple', 'marble', 'marsh',
  'meadow', 'meridian', 'mesa', 'mist', 'moraine', 'moss', 'nectar', 'nettle',
  'nimbus', 'nutmeg', 'oasis', 'oat', 'obelisk', 'ochre', 'olive', 'onyx',
  'opal', 'orbit', 'orchid', 'osprey', 'otter', 'paddle', 'palm', 'pebble',
  'pepper', 'pewter', 'pine', 'plateau', 'plum', 'pond', 'poplar', 'prairie',
  'quarry', 'quartz', 'quill', 'quilt', 'raven', 'reed', 'ridge', 'river',
  'robin', 'rosemary', 'rustic', 'saddle', 'saffron', 'sage', 'salt', 'sapling',
  'sequoia', 'shale', 'shore', 'sienna', 'silt', 'slate', 'sorrel', 'sparrow',
  'spruce', 'summit', 'sunset', 'swallow', 'sycamore', 'tangerine', 'thicket', 'thistle',
  'thyme', 'timber', 'tundra', 'valley', 'velvet', 'violet', 'walnut', 'warbler',
  'wattle', 'willow', 'wren', 'zephyr',
];

function pickWords(count) {
  const pool = [...WORDS];
  const picked = [];
  for (let i = 0; i < count; i++) {
    const idx = randomInt(pool.length);
    picked.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return picked;
}

const password = [...pickWords(3), randomInt(1000)].join('-');
const sessionSecret = randomBytes(32).toString('hex');

console.log(`APP_PASSWORD=${password}`);
console.log(`SESSION_SECRET=${sessionSecret}`);
