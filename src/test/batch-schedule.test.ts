import {it,expect} from "vitest";
import {nextDaySlots} from "@/lib/studio-rules";
it("schedules batch clips on the following day, 2 hours apart from 10:00",()=>{
  const s=nextDaySlots(3,new Date(2026,9,27,22,0));
  expect(s.map(d=>[d.getDate(),d.getHours()])).toEqual([[28,10],[28,12],[28,14]]);
});
