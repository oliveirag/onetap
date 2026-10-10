import { indexForOffset, moveId, orderFromPositions, positionsFromOrder } from './reorder';

it('moves an id to a new index, shifting the ones between', () => {
  expect(moveId(['a', 'b', 'c', 'd'], 'a', 2)).toEqual(['b', 'c', 'a', 'd']);
  expect(moveId(['a', 'b', 'c', 'd'], 'd', 0)).toEqual(['d', 'a', 'b', 'c']);
  expect(moveId(['a', 'b', 'c'], 'b', 1)).toEqual(['a', 'b', 'c']);
});

it('clamps the drop index to the list', () => {
  expect(indexForOffset(-500, 64, 4)).toBe(0);
  expect(indexForOffset(10_000, 64, 4)).toBe(3);
});

it('rounds the dragged row top to the nearest slot', () => {
  expect(indexForOffset(64 * 1.4, 64, 4)).toBe(1);
  expect(indexForOffset(64 * 1.6, 64, 4)).toBe(2);
});

it('round-trips between an order and a positions map', () => {
  const positions = positionsFromOrder(['x', 'y', 'z']);
  expect(positions).toEqual({ x: 0, y: 1, z: 2 });
  expect(orderFromPositions(positions)).toEqual(['x', 'y', 'z']);
});
