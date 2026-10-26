import {describe,it,expect} from "vitest";
import {providers,providerBaseUrl,endpointSchema} from "@/lib/studio-rules";
describe("Custom AI endpoints",()=>{
 it("includes a custom provider option",()=>{expect(providers).toContain("custom");});
 it("uses fixed base URLs for hosted providers",()=>{expect(providerBaseUrl("openai")).toBe("https://api.openai.com/v1");expect(providerBaseUrl("openrouter")).toBe("https://openrouter.ai/api/v1");expect(providerBaseUrl("gemini")).toBeNull();expect(providerBaseUrl("anthropic")).toBeNull();});
 it("requires a base URL for custom endpoints",()=>{expect(()=>providerBaseUrl("custom")).toThrow();expect(()=>providerBaseUrl("custom","not-a-url")).toThrow();});
 it("accepts and normalizes a custom base URL",()=>{expect(providerBaseUrl("custom","https://api.example.com/v1/")).toBe("https://api.example.com/v1");});
 it("rejects non-HTTP base URLs",()=>{expect(endpointSchema.safeParse("ftp://example.com").success).toBe(false);expect(endpointSchema.safeParse("http://localhost:8080/v1").success).toBe(true);});
});
