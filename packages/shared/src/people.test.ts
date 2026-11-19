import { describe, expect, it } from 'vitest';
import {
  addressInputSchema,
  isWeakPin,
  personNameSchema,
  pincodeSchema,
  serviceAreaInputSchema,
} from './people';

describe('people inputs', () => {
  it('accepts Kerala PIN codes and refuses short, long or 0-leading ones', () => {
    expect(pincodeSchema.parse(' 682030 ')).toBe('682030');
    for (const bad of ['68203', '6820300', '082030', '68203a', '']) {
      expect(pincodeSchema.safeParse(bad).success).toBe(false);
    }
  });

  it('trims names and needs at least 2 letters', () => {
    expect(personNameSchema.parse('  Anitha R ')).toBe('Anitha R');
    expect(personNameSchema.safeParse('A').success).toBe(false);
  });

  it('needs house, landmark and PIN code for an address; location and note are optional', () => {
    const ok = addressInputSchema.safeParse({
      label: 'Home',
      line: 'Rose Villa',
      landmark: 'Near the church',
      pincode: '682030',
    });
    expect(ok.success).toBe(true);
    const missing = addressInputSchema.safeParse({
      label: 'Home',
      line: ' ',
      landmark: 'x',
      pincode: '682030',
    });
    expect(missing.success).toBe(false);
    expect(
      addressInputSchema.safeParse({
        label: 'H',
        line: 'a',
        landmark: 'b',
        pincode: '682030',
        latitude: 91,
      }).success,
    ).toBe(false);
  });

  it('a delivery area needs at least one valid PIN code', () => {
    expect(serviceAreaInputSchema.safeParse({ name: 'Kakkanad', pincodes: [] }).success).toBe(
      false,
    );
    expect(
      serviceAreaInputSchema.safeParse({ name: 'Kakkanad', pincodes: ['682030'] }).success,
    ).toBe(true);
  });

  it('flags PINs anyone would guess first', () => {
    for (const weak of ['1234', '0000', '1111', '2580']) expect(isWeakPin(weak)).toBe(true);
    for (const fine of ['5831', '7302']) expect(isWeakPin(fine)).toBe(false);
  });
});
