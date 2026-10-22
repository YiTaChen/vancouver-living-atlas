import test from 'node:test';
import assert from 'node:assert/strict';
import { cityModule } from './helpers/city-modules.mjs';

const { PassengerTransfers } = await import(
  cityModule('city-life/passenger-transfers')
);
const floor = { x: 0, y: 0, z: 0, surfaceId: 'curb', layer: 0 };
const proof = () => ({
  vehicleId: 'bus',
  serviceId: 'ride',
  carId: 'cabin',
  stopId: 'stop',
  platformId: 'curb',
  doorId: 'front',
  doorSide: 'right',
  surfaceId: 'curb',
  layer: 0,
  floorPointM: [0, 0, 0],
  speedMps: 0,
  stoppedSeconds: 0.5,
  distanceM: 1,
  doorOpen: true,
  correctDoorSide: true,
  alignmentValid: true,
  zoneClear: true,
  lineOfSight: true,
  passengerCapable: true,
  floorValid: true,
});
const anchor = (id = 'aisle', kind = 'standing') => ({
  vehicleId: 'bus',
  carId: 'cabin',
  anchorId: id,
  frameId: 'vehicle',
  kind,
  translationM: [0, 0.36, 0],
  rotationQuaternionXYZW: [0, 0, 0, 1],
});
function board(transfers, id, target = anchor()) {
  assert(transfers.register(id, floor));
  const token = transfers.beginBoard(id, target, proof(), 0);
  assert(token);
  assert(transfers.markPreloaded(token, 0));
  assert(transfers.commit(token, proof(), 0));
}

test('an onboard seat/stand change atomically transfers occupancy and copies the new local anchor', () => {
  const transfers = new PassengerTransfers();
  board(transfers, 'rider');
  const before = transfers.state('rider');
  const seat = anchor('seat-01', 'seat');
  seat.translationM = [0.8, 0.9, -1.3];
  assert(transfers.changeRideAnchor('rider', seat));
  assert.deepEqual(transfers.state('rider'), { ...before, anchor: seat });
  seat.translationM[0] = 999;
  assert.equal(transfers.state('rider').anchor.translationM[0], 0.8);
  board(transfers, 'second', anchor());
  assert.equal(transfers.occupantsFor('bus'), 2);
  assert.equal(
    transfers.changeRideAnchor('second', anchor('seat-01', 'seat')),
    false,
  );
  assert.equal(transfers.changeRideAnchor('rider', anchor()), false);
  const newAisle = anchor('aisle-rear');
  assert(transfers.changeRideAnchor('rider', newAisle));
  assert.equal(transfers.state('rider').serviceId, 'ride');
  assert.equal(transfers.state('rider').stopId, 'stop');
  assert(transfers.register('third', floor));
  assert(transfers.beginBoard('third', anchor('seat-01', 'seat'), proof(), 1));
});

test('seat/stand changes cannot steal a reserved target or release their current seat on rejection', () => {
  const transfers = new PassengerTransfers();
  board(transfers, 'rider');
  assert(transfers.register('boarding', floor));
  const seat = anchor('seat-02', 'seat');
  const token = transfers.beginBoard('boarding', seat, proof(), 0);
  assert(token);
  const original = transfers.state('rider');
  assert.equal(transfers.changeRideAnchor('rider', seat), false);
  assert.deepEqual(transfers.state('rider'), original);
  assert(transfers.cancel(token));
  assert(transfers.changeRideAnchor('rider', seat));
  assert.equal(transfers.beginBoard('boarding', seat, proof(), 1), null);
});

test('pending boarding/alighting pins the source and an anchor switch does not invalidate its original transfer token', () => {
  const transfers = new PassengerTransfers();
  board(transfers, 'rider', anchor('seat-03', 'seat'));
  const token = transfers.beginAlight('rider', floor, proof(), 1);
  assert(token);
  assert.equal(transfers.changeRideAnchor('rider', anchor()), false);
  assert.equal(transfers.state('rider').anchor.anchorId, 'seat-03');
  assert(transfers.markPreloaded(token, 1));
  assert(transfers.commit(token, proof(), 1));
  assert.equal(transfers.occupantsFor('bus'), 0);
  assert.equal(transfers.changeRideAnchor('rider', anchor()), false);
  assert.equal(transfers.changeRideAnchor('missing', anchor()), false);
});

test('same-anchor calls are idempotent only for the exact authored datum and cannot change cars, frames or invalid transforms', () => {
  const transfers = new PassengerTransfers();
  board(transfers, 'rider');
  const original = transfers.state('rider');
  assert(transfers.changeRideAnchor('rider', anchor()));
  for (const change of [
    { vehicleId: 'other' },
    { carId: 'other' },
    { frameId: 'other' },
    { anchorId: '' },
    { anchorId: 1 },
    { kind: 'seat' },
    { translationM: [0.1, 0.36, 0] },
    { translationM: [0, NaN, 0] },
    { translationM: [0, 0] },
    { translationM: null },
    { rotationQuaternionXYZW: [0, 0, 0, 0] },
    { rotationQuaternionXYZW: [0, 0, 0, -1] },
    { rotationQuaternionXYZW: null },
  ]) {
    assert.equal(
      transfers.changeRideAnchor('rider', { ...anchor(), ...change }),
      false,
    );
    assert.deepEqual(transfers.state('rider'), original);
  }
  assert.equal(transfers.changeRideAnchor('rider', null), false);
  assert.equal(transfers.changeRideAnchor('rider', undefined), false);
});
