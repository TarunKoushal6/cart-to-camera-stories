import {it,expect} from "vitest";
import {nextDaySlots} from "@/lib/studio-rules";
it("schedules batch clips on the following day, 2 hours apart from 10:00",()=>{
  const s=nextDaySlots(3,new Date(2026,9,27,22,0));
  expect(s.map(d=>[d.getDate(),d.getHours()])).toEqual([[28,10],[28,12],[28,14]]);
});
it("keeps all 15 cloud clips on the following day in increasing time order",()=>{
  const s=nextDaySlots(15,new Date(2026,9,27,22,0));
  expect(s.map(d=>d.getDate())).toEqual(Array(15).fill(28));
  expect(s[0]?.getHours()).toBe(10);
  expect(s[14]?.getHours()).toBe(23);
  expect(s.every((d,i)=>i===0||d.getTime()>(s[i-1]?.getTime()||0))).toBe(true);
});
