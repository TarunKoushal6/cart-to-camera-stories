import {describe,it,expect} from "vitest";
import {edgeGec} from "../lib/edge-token.server";
describe("Edge token window",()=>{
  it("matches the current Edge reference token",()=>{expect(edgeGec(1700000100)).toBe("0919602B5750900A-EC9DD394F23CB5635CF62A0E8E24136DCD32B26D10C543B10082E482D7516397");});
  it("holds a token stable within the five-minute service window",()=>{expect(edgeGec(1700000100)).toBe(edgeGec(1700000399));expect(edgeGec(1700000400)).not.toBe(edgeGec(1700000100));});
});