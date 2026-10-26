import {describe,it,expect} from "vitest";
import {edgeGec} from "../lib/edge-token.server";
describe("Edge token window",()=>{
  it("holds a token stable within the five-minute service window",()=>{expect(edgeGec(1700000100)).toBe(edgeGec(1700000399));expect(edgeGec(1700000400)).not.toBe(edgeGec(1700000100));});
});