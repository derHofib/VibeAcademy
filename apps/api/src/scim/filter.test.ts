import { describe, expect, it } from 'vitest';
import { FilterError, paging, parseEqFilter, parsePatchPath, scimBool } from './filter';

describe('SCIM-Filter', () => {
  const users = ['username', 'externalid', 'emails.value', 'id'];
  it('versteht userName eq und externalId eq (Attribut ohne Groß-/Kleinschreibung)', () => {
    expect(parseEqFilter('userName eq "anna@firma.de"', users)).toEqual({ attr: 'username', value: 'anna@firma.de' });
    expect(parseEqFilter('  externalId EQ "00u1\\"x"  ', users)).toEqual({ attr: 'externalid', value: '00u1"x' });
    expect(parseEqFilter('emails.value eq "a@b.de"', users)).toEqual({ attr: 'emails.value', value: 'a@b.de' });
  });
  it('lehnt andere Operatoren, Verknüpfungen und unbekannte Attribute ab', () => {
    expect(() => parseEqFilter('userName co "anna"', users)).toThrow(FilterError);
    expect(() => parseEqFilter('userName eq "a" and active eq true', users)).toThrow(FilterError);
    expect(() => parseEqFilter('title eq "x"', users)).toThrow(/nicht unterstützt/);
    expect(() => parseEqFilter('userName eq anna', users)).toThrow(FilterError);
  });
});

describe('SCIM-PATCH-Pfade', () => {
  it('einfache, Unter- und Erweiterungsattribute', () => {
    expect(parsePatchPath('active')).toEqual({ attr: 'active' });
    expect(parsePatchPath('name.givenName')).toEqual({ attr: 'name.givenname' });
    expect(parsePatchPath('urn:ietf:params:scim:schemas:extension:enterprise:2.0:User:department')).toEqual({ attr: 'enterprise:department' });
    expect(parsePatchPath('urn:ietf:params:scim:schemas:core:2.0:User:displayName')).toEqual({ attr: 'displayname' });
  });
  it('Wertefilter', () => {
    expect(parsePatchPath('emails[type eq "work"].value')).toEqual({ attr: 'emails', where: { attr: 'type', value: 'work' }, sub: 'value' });
    expect(parsePatchPath('members[value eq "abc"]')).toEqual({ attr: 'members', where: { attr: 'value', value: 'abc' } });
  });
  it('ungültige Pfade', () => {
    expect(() => parsePatchPath('emails[type co "w"]')).toThrow(FilterError);
    expect(() => parsePatchPath('1abc')).toThrow(FilterError);
  });
});

describe('Hilfen', () => {
  it('scimBool akzeptiert „False“ als Zeichenkette', () => {
    expect(scimBool('False')).toBe(false);
    expect(scimBool(true)).toBe(true);
    expect(scimBool('nein')).toBeUndefined();
  });
  it('paging', () => {
    expect(paging(undefined, undefined)).toEqual({ offset: 0, limit: 100, startIndex: 1 });
    expect(paging('3', '2')).toEqual({ offset: 2, limit: 2, startIndex: 3 });
    expect(paging('0', '1000')).toEqual({ offset: 0, limit: 200, startIndex: 1 });
    expect(paging(1, 0)).toEqual({ offset: 0, limit: 0, startIndex: 1 });
  });
});
