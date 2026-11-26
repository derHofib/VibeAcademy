import { Injectable } from '@nestjs/common';

/** Injizierbare Uhr (E-14). Tests ersetzen sie durch eine steuerbare Uhr. */
@Injectable()
export class Clock {
  now(): Date {
    return new Date();
  }
}

export class FakeClock extends Clock {
  constructor(private t = new Date('2026-12-01T08:00:00Z')) {
    super();
  }
  override now(): Date {
    return new Date(this.t);
  }
  set(t: Date | string) {
    this.t = new Date(t);
  }
  advance(ms: number) {
    this.t = new Date(this.t.getTime() + ms);
  }
}
