// turns a redis style glob (h?llo, h*llo, h[ae]llo, h[^e]llo, h[a-b]llo) into a RegExp for KEYS
export function globToRegExp(pattern: string): RegExp {
  let source = '';

  for (let i = 0; i < pattern.length; i++) {
    const char = pattern[i];

    if (char === '*') {
      source += '.*';
    } else if (char === '?') {
      source += '.';
    } else if (char === '\\' && i + 1 < pattern.length) {
      source += escapeRegExp(pattern[++i]);
    } else if (char === '[') {
      const close = pattern.indexOf(']', i + 1);
      if (close === -1) {
        source += '\\[';
        continue;
      }
      let body = pattern.slice(i + 1, close).replace(/\\/g, '\\\\');
      if (body.startsWith('!')) body = '^' + body.slice(1);
      source += `[${body}]`;
      i = close;
    } else {
      source += escapeRegExp(char);
    }
  }

  return new RegExp(`^${source}$`, 's');
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}
