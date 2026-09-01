/* ══════ ANNEX 台帳 — 金額計算の共通部分 ══════
   自分用ページ（index.html）と管理ページ（admin/index.html）の両方がこれを読み込みます。
   手取りの計算式を1か所にまとめて、2つの画面で数字がずれないようにするためです。 */

const ROUND_MIN=30;                                    // 時給の丸め単位（切り捨て）
const yen=n=>Math.round(n).toLocaleString("ja-JP");
const pad=n=>String(n).padStart(2,"0");
const todayStr=()=>{const d=new Date();return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;};

function hhmm(n){const h=Math.floor(n/60),m=n%60;return h?`${h}時間${m?m+"分":""}`:`${m}分`;}

/* "HH:MM" 2つの差を分で。退勤が出勤より小さければ日跨ぎ */
function spanMin(a,b){if(!a||!b)return null;
  const p=s=>{const[h,m]=s.split(":").map(Number);return h*60+(m||0);};
  let d=p(b)-p(a); if(d<0)d+=1440; return d;}

/* 出退勤のうち、時給の対象時間帯（既定 21:30〜2:00）に重なっている分だけを返す。
   出勤を基準にして相対分に直すので、どちらが日をまたいでも成立する */
const WAGE_FROM="21:30", WAGE_TO="02:00";
function toMin(s){const[h,m]=s.split(":").map(Number);return h*60+(m||0);}
function paidMin(rec,st){
  if(!rec||!rec.inT||!rec.outT) return null;
  const from=(st&&st.wageFrom)||WAGE_FROM, to=(st&&st.wageTo)||WAGE_TO;
  const end=spanMin(rec.inT,rec.outT);                 // 出勤からの拘束時間
  let ws=toMin(from)-toMin(rec.inT);                   // 対象開始は出勤の何分後か
  if(ws<-720) ws+=1440; else if(ws>720) ws-=1440;      // ±12時間の範囲に寄せる
  let len=(toMin(to)-toMin(from)+1440)%1440; if(!len) len=1440;
  const we=ws+len;
  return Math.max(0,Math.min(end,we)-Math.max(0,ws));
}
function autoHours(rec,st){const mn=paidMin(rec,st); if(mn===null)return null;
  return Math.floor(mn/ROUND_MIN)*ROUND_MIN/60;}

/* 卓の滞在時間。基本50分＋延長25分×回数。自己記録は卓ではないので0 */
function tableMin(t){return (t.source==="riko"||t.temp)?0:50+(t.ext||0)*25;}

/* 1日ぶん。tl=その日の卓の配列、rec={hours,okuri,inT,outT}、st=ステータス */
function calcDay(tl,rec,st){
  tl=tl||[]; rec=rec||{hours:0,okuri:false,inT:"",outT:""};
  const back=tl.reduce((s,t)=>s+t.back,0),pay=tl.reduce((s,t)=>s+t.pay,0);
  const inT=rec.inT||"",outT=rec.outT||"";
  const rawMin=spanMin(inT,outT),paid=paidMin(rec,st),auto=autoHours(rec,st);
  const hours=(auto!==null)?auto:(rec.hours||0),okuri=!!rec.okuri;
  const stayMin=tl.reduce((s,t)=>s+tableMin(t),0);
  const base=paid||rawMin;
  const rate=(base&&stayMin)?Math.min(100,Math.round(stayMin/base*100)):null;
  const wage=st.hourly*hours,gross=back+wage;
  /* 時給のうち卓についていた時間ぶん。実働時間を超えないよう頭打ちにする */
  const stayWageRaw=st.hourly*stayMin/60;
  const stayWage=Math.min(stayWageRaw,wage),idleWage=wage-stayWage;
  const wageF=stayWageRaw>0?stayWage/stayWageRaw:0;
  const tableTake=t=>t.back+st.hourly*tableMin(t)/60*wageF;
  const takeTotal=tl.reduce((s,t)=>s+tableTake(t),0);
  const gensen=st.gensen?gross*0.1021:0;
  const kousei=tl.length?st.kousei:0;
  const okuriFee=okuri?st.okuri:0;
  const fixed=kousei+okuriFee;
  return {back,pay,hours,okuri,wage,gross,gensen,kousei,okuriFee,fixed,
    inT,outT,rawMin,paid,auto,stayMin,rate,stayWage,idleWage,tableTake,takeTotal,
    wageF,
    take:Math.max(0,gross-gensen-fixed)};
}

/* 1か月ぶん。map={日付:[卓]}、dayRecs={日付:{hours,okuri,inT,outT}} */
function calcMonth(map,dayRecs,st){
  dayRecs=dayRecs||{};
  let take=0,pay=0,tables=0,days=0,hours=0,wage=0,back=0,stayMin=0,stayWage=0,takeTotal=0;
  Object.keys(map).forEach(d=>{const r=calcDay(map[d],dayRecs[d],st);
    take+=r.take;pay+=r.pay;tables+=map[d].length;
    hours+=r.hours;wage+=r.wage;back+=r.back;stayMin+=r.stayMin;
    stayWage+=r.stayWage;takeTotal+=r.takeTotal;
    if(map[d].length||(dayRecs[d]&&(dayRecs[d].hours||dayRecs[d].inT)))days++;});
  return {take,pay,tables,days,hours,wage,back,stayMin,stayWage,takeTotal};
}

/* 日付キーで {日付:[卓]} を作る。dayRecs にしかない日も空配列で入れる */
function groupByDay(tables,dayRecs){
  const m={}; (tables||[]).forEach(t=>{(m[t.work_date]=m[t.work_date]||[]).push(t);});
  Object.keys(dayRecs||{}).forEach(d=>{if(!m[d])m[d]=[];});
  return m;
}

/* 行 → ステータス、ステータス → 行 */
function statusFromRow(r){return{hourly:r.hourly,bkHon:+r.bk_hon,bkJonai:+r.bk_jonai,bkDohan:+r.bk_dohan,
  bk:{cast:+r.bk_cast,shot:+r.bk_shot,champ:+r.bk_champ,wine:+r.bk_wine,bottle:+r.bk_bottle,food:+r.bk_food,other:+r.bk_other},
  base:r.base,attr:r.attr,kousei:r.kousei,okuri:r.okuri,gensen:r.gensen,
  wageFrom:(r.wage_from||WAGE_FROM).slice(0,5),wageTo:(r.wage_to||WAGE_TO).slice(0,5),
  updatedAt:r.updated_at};}
function statusToRow(s){return{hourly:s.hourly,bk_hon:s.bkHon,bk_jonai:s.bkJonai,bk_dohan:s.bkDohan,
  bk_cast:s.bk.cast,bk_shot:s.bk.shot,bk_champ:s.bk.champ,bk_wine:s.bk.wine,bk_bottle:s.bk.bottle,
  bk_food:s.bk.food,bk_other:s.bk.other,base:s.base,attr:s.attr,kousei:s.kousei,okuri:s.okuri,
  gensen:s.gensen,wage_from:s.wageFrom||WAGE_FROM,wage_to:s.wageTo||WAGE_TO,
  updated_at:new Date().toISOString()};}
function dayFromRow(x){return{hours:+x.hours,okuri:!!x.okuri,
  inT:(x.in_time||"").slice(0,5),outT:(x.out_time||"").slice(0,5)};}
