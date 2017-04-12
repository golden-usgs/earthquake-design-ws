/* global describe, it */
'use strict';

var DeterministicHandler = require('../src/lib/deterministic-handler'),
    expect = require('chai').expect;


describe('deterministic-handler', () => {
  describe('constructor', () => {
    it('is defined', () => {
      expect(typeof DeterministicHandler).to.equal('function');
    });

    it('can be instantiated', () => {
      expect(DeterministicHandler).to.not.throw(Error);
    });

    it('can be destroyed', () => {
      var handler;

      handler = DeterministicHandler();
      expect(handler.destroy).to.not.throw(Error);
    });
  });
});
