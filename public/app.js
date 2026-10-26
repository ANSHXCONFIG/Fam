let token = sessionStorage.getItem("fup_token") || "";
const $ = id => document.getElementById(id);
async function api(path, options={}) {
  const res = await fetch(path, { ...options, headers: { "Content-Type":"application/json", ...(token ? {Authorization:`Bearer ${token}`} : {}), ...(options.headers||{}) }});
  const data = await res.json().catch(()=>({error:"Unexpected server response"}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}
function msg(s){$("authmsg").textContent=s}
$("signup").onclick=async()=>{try{const d=await api("/api/auth/signup",{method:"POST",body:JSON.stringify({name:$("name").value,email:$("email").value,password:$("password").value})});token=d.token;sessionStorage.setItem("fup_token",token);msg("Account created. Token expires in 2 hours.");await refresh()}catch(e){msg(e.message)}};
$("login").onclick=async()=>{try{const d=await api("/api/auth/login",{method:"POST",body:JSON.stringify({email:$("email").value,password:$("password").value})});token=d.token;sessionStorage.setItem("fup_token",token);msg("Signed in successfully.");await refresh()}catch(e){msg(e.message)}};
async function refresh(){try{const d=await api("/api/dashboard");$("total").textContent=d.total_requests;$("success").textContent=d.successful;$("failed").textContent=d.failed;$("revenue").textContent="₹"+(Number(d.revenue_paise)/100).toFixed(2);const tx=await api("/api/transactions");$("txlist").innerHTML=tx.data.length?tx.data.map(t=>`<div class="txrow"><span>${escapeHtml(t.order_id)}<br><small>${new Date(t.created_at).toLocaleString()}</small></span><span>₹${Number(t.amount).toFixed(2)}<br><small>${escapeHtml(t.status)}</small></span></div>`).join(""):"No transactions yet.";msg("Dashboard updated.")}catch(e){msg(e.message)}}
function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
$("refresh").onclick=refresh;
$("newkey").onclick=async()=>{try{const d=await api("/api/keys",{method:"POST",body:JSON.stringify({label:"Dashboard key"})});$("keyout").textContent=d.api_key+"\n\n"+d.warning;$("keyout").classList.remove("hidden")}catch(e){msg(e.message)}};
if(token)refresh();