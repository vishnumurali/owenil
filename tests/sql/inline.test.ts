import { expect, it } from 'vitest';
import { inlineParams } from '../../scripts/lib';

it('inlines parameters as safe SQL literals for the Management API backend', () => {
  const params = ["O'Brien", 12, true, null, 5, 6, 7, 8, 9, 'ten'];
  expect(inlineParams('select $1, $2, $3, $4, $10', params)).toBe("select 'O''Brien', 12, TRUE, NULL, 'ten'");
  expect(inlineParams('where id = any($1::uuid[])', [['x', "y'"]])).toBe("where id = any(ARRAY['x', 'y''']::uuid[])");
  expect(inlineParams('select 1 + 1', [])).toBe('select 1 + 1');
});
