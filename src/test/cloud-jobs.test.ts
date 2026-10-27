import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ status: "finalizing", reviewed: false, leased: true, updates: [] as Record<string, unknown>[] }));
const id = "00000000-0000-4000-8000-000000000001";
const path = `owner/clips/${id}/job.mp4`;
const critique = {hook:80,pacing:75,retention:80,verdict:"Viral",critique:"Transcript-based estimate",feedback:["Tighten ending"],evidence:"transcript"};
function query(table: string) {
  let update: Record<string, unknown> | undefined;
  const q: Record<string, unknown> = {};
  for (const method of ["select","eq","in","is"]) q[method] = () => q;
  q['update'] = (data: Record<string, unknown>) => { update = data; state.updates.push(data); return q; };
  const result = () => {
    if (update) {
      if (update['viral_review']) state.reviewed = true;
      return {data:{id,caption:"Hello",voiceover:null,start_seconds:0,end_seconds:25},error:null};
    }
    if (table === "studio_cloud_jobs") return {data:{id,source_id:id,user_id:"owner",status:state.status,worker_url:"https://worker.example.com",worker_job_id:id,clips:[{id,path,segment:{title:"Moment",start:0,end:25,score:80,reason:"Hook"}}]},error:null};
    if (table === "studio_credentials") return {data:[{kind:"cloud_worker",base_url:"https://worker.example.com",encrypted_key:"x"},{kind:"ai",provider:"custom",model:"test",encrypted_key:"x",base_url:"https://ai.example.com"}],error:null};
    if (table === "studio_sources") return {data:{transcript:[{start:0,end:25,text:"Hello"}]},error:null};
    return {data:[{id,video_path:state.reviewed?path:null,viral_review:state.reviewed?critique:null}],error:null};
  };
  q['single'] = q['maybeSingle'] = async () => result();
  q['then'] = (resolve: (value: unknown) => unknown) => Promise.resolve(result()).then(resolve);
  return q;
}
const db = {from:query,rpc:async()=>({data:state.leased,error:null}),storage:{from:()=>({list:async()=>({data:[{name:"job.mp4",metadata:{mimetype:"video/mp4",size:1000}}],error:null})})}};
vi.mock("@/integrations/supabase/client.server",()=>({supabaseAdmin:db}));
vi.mock("@/lib/studio-crypto.server",()=>({decrypt:async()=>"key"}));
vi.mock("@/lib/cloud-clipper.server",()=>({callWorker:async()=>({status:"complete",completed:[id]})}));
vi.mock("@/lib/studio-ai.server",()=>({reviewWithKey:async()=>critique}));
beforeEach(()=>{ state.status="finalizing"; state.reviewed=false; state.leased=true; state.updates=[]; vi.stubEnv("STUDIO_ENCRYPTION_KEY","test"); });
it("resumes interrupted finalization, attaches the exact MP4 and reviews without approving or posting",async()=>{
  const {advanceCloudCut}=await import("@/lib/cloud-clipper-jobs.server");
  const result=await advanceCloudCut({jobId:id}, {supabase:db as never,userId:"owner"});
  expect(result.status).toBe("ready");
  expect(state.updates).toContainEqual({video_path:path,approved_at:null});
  expect(state.updates.some(u=>u['viral_review']&&u['approved_at']===null)).toBe(true);
  expect(state.updates.some(u=>typeof u['approved_at']==="string")).toBe(false);
  expect(state.updates.at(-1)).toEqual({processing_token:null,processing_until:null});
});
it("does not process a job already held by another poll",async()=>{
  state.leased=false;
  const {advanceCloudCut}=await import("@/lib/cloud-clipper-jobs.server");
  expect(await advanceCloudCut({jobId:id},{supabase:db as never,userId:"owner"})).toEqual({status:"finalizing"});
  expect(state.updates).toEqual([]);
});