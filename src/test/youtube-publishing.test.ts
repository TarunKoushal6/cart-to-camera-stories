import { describe,it,expect } from "vitest";
import { youtubePublishSchema,youtubeMetadata,youtubeCounts } from "@/lib/youtube-publishing-rules";
const base={clipId:"00000000-0000-4000-8000-000000000001",title:"My Short",description:"A moment",tags:["shorts"],privacy:"public" as const,scheduledAt:null,madeForKids:false};
describe("YouTube publishing",()=>{
 it("supports public, unlisted and private uploads",()=>{for(const privacy of ["public","unlisted","private"] as const)expect(youtubeMetadata({...base,privacy}).status.privacyStatus).toBe(privacy);expect(youtubePublishSchema.safeParse({...base,privacy:"friends"}).success).toBe(false);});
 it("schedules public releases privately with publishAt",()=>{const data={...base,scheduledAt:"2027-01-01T12:00:00Z"};expect(youtubeMetadata(data).status).toMatchObject({privacyStatus:"private",publishAt:"2027-01-01T12:00:00Z"});expect(youtubePublishSchema.safeParse({...data,privacy:"unlisted"}).success).toBe(false);});
 it("retains title, description and tags",()=>{expect(youtubeMetadata(base).snippet).toMatchObject({title:"My Short",description:"A moment",tags:["shorts"]});});
 it("reads YouTube views likes and comments without inventing missing counts",()=>{expect(youtubeCounts({viewCount:"123",likeCount:"7",commentCount:"2"})).toEqual({views:123,likes:7,comments:2});expect(youtubeCounts({viewCount:"0"})).toEqual({views:0,likes:null,comments:null});});
});