(function(){
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const patterns = {
    IND:(p)=>`<rect width="120" height="40" y="0" fill="#ff9933"/><rect width="120" height="40" y="40" fill="#fff"/><rect width="120" height="40" y="80" fill="#138808"/><circle cx="60" cy="60" r="13" fill="none" stroke="#1a4ba0" stroke-width="3"/><circle cx="60" cy="60" r="2.5" fill="#1a4ba0"/>`,
    WI:(p)=>`<rect width="120" height="120" fill="#5bc0de"/><rect y="74" width="120" height="46" fill="#0878b5"/><circle cx="88" cy="31" r="15" fill="#ffd632"/><path d="M22 93h49l-10-9H32z" fill="#45a23f"/><path d="M42 91c12-31 14-46 11-61 11 11 17 20 13 31 8-12 18-14 27-11-9 1-18 7-24 15 8-5 15-4 21 1-9 0-17 4-25 11l-8 14z" fill="#7a1736"/><path d="M70 75h5v23h-5zm12 0h5v23h-5zm12 0h5v23h-5z" fill="#ffd632"/>`,
    PAK:(p)=>`<rect width="120" height="120" fill="#075b35"/><rect width="28" height="120" fill="#fff"/><circle cx="70" cy="58" r="25" fill="#fff"/><circle cx="80" cy="53" r="23" fill="#075b35"/><path d="M89 35l4 9 10 1-8 6 3 10-9-5-9 5 3-10-8-6 10-1z" fill="#fff"/>`,
    ENG:(p)=>`<rect width="120" height="120" fill="#fff"/><rect x="50" width="20" height="120" fill="#c8102e"/><rect y="50" width="120" height="20" fill="#c8102e"/>`,
    AUS:(p)=>`<rect width="120" height="120" fill="#006644"/><path d="M60 18l8 18 20 2-15 13 5 20-18-10-18 10 5-20-15-13 20-2z" fill="#ffcf21"/><circle cx="88" cy="87" r="8" fill="#ffcf21"/><circle cx="30" cy="88" r="6" fill="#ffcf21"/>`,
    NZ:(p)=>`<rect width="120" height="120" fill="#101318"/><path d="M34 95c24-20 34-43 35-72 7 26-2 52-35 72zm9-7c18-9 31-22 39-40-2 18-15 35-39 40z" fill="#e8edf4"/>`,
    SA:(p)=>`<rect width="120" height="120" fill="#007749"/><path d="M0 17l48 43L0 103z" fill="#ffb81c"/><path d="M0 28l36 32L0 92z" fill="#000"/><path d="M120 21H67L24 60l43 39h53V81H75L53 60l22-21h45z" fill="#fff" opacity=".9"/>`,
    BAN:(p)=>`<rect width="120" height="120" fill="#006a4e"/><circle cx="68" cy="60" r="28" fill="#f42a41"/>`,
    SL:(p)=>`<rect width="120" height="120" fill="#8d153a"/><rect x="7" y="7" width="106" height="106" fill="none" stroke="#ffb81c" stroke-width="10"/><path d="M46 81c16-2 28-12 31-27 8 15 0 33-14 40-6 3-12 4-17 4z" fill="#ffb81c"/><path d="M49 47l11-12 9 11 13-5-4 15-29-9z" fill="#ffb81c"/>`,
    AFG:(p)=>`<rect width="40" height="120" fill="#000"/><rect x="40" width="40" height="120" fill="#d3202e"/><rect x="80" width="40" height="120" fill="#168c45"/><circle cx="60" cy="60" r="18" fill="none" stroke="#fff" stroke-width="3"/>`,
    NEP:(p)=>`<rect width="120" height="120" fill="#003893"/><path d="M22 10v100h75L54 72h35L22 10z" fill="#dc143c" stroke="#fff" stroke-width="5"/><circle cx="45" cy="76" r="9" fill="#fff"/><path d="M44 37l5 8 9-2-5 8 5 8-9-2-5 8-1-9-9-3 9-3z" fill="#fff"/>`,
    USA:(p)=>`<rect width="120" height="120" fill="#fff"/>${[0,18,36,54,72,90,108].map(y=>`<rect y="${y}" width="120" height="9" fill="#b22234"/>`).join('')}<rect width="58" height="60" fill="#3c3b6e"/><text x="29" y="38" fill="#fff" font-size="27" text-anchor="middle">★</text>`,
    CAN:(p)=>`<rect width="120" height="120" fill="#fff"/><rect width="26" height="120" fill="#d80621"/><rect x="94" width="26" height="120" fill="#d80621"/><path d="M60 29l7 17 15-8-5 18 13 4-14 10 5 17-17-7-4 20-4-20-17 7 5-17-14-10 13-4-5-18 15 8z" fill="#d80621"/>`,
    IRE:(p)=>`<rect width="40" height="120" fill="#169b62"/><rect x="40" width="40" height="120" fill="#fff"/><rect x="80" width="40" height="120" fill="#ff883e"/>`,
    NED:(p)=>`<rect width="120" height="40" fill="#ae1c28"/><rect y="40" width="120" height="40" fill="#fff"/><rect y="80" width="120" height="40" fill="#21468b"/>`,
    SCO:(p)=>`<rect width="120" height="120" fill="#244b8f"/><path d="M-10 3L9-9l121 126-19 12zM111-9l19 12L9 129l-19-12z" fill="#fff"/>`,
    ZIM:(p)=>`<rect width="120" height="120" fill="#319208"/><rect y="20" width="120" height="20" fill="#ffd200"/><rect y="40" width="120" height="20" fill="#d21034"/><rect y="60" width="120" height="20" fill="#000"/><rect y="80" width="120" height="20" fill="#d21034"/><path d="M0 0l55 60L0 120z" fill="#fff"/>`,
    UAE:(p)=>`<rect x="26" width="94" height="40" fill="#00732f"/><rect x="26" y="40" width="94" height="40" fill="#fff"/><rect x="26" y="80" width="94" height="40" fill="#000"/><rect width="26" height="120" fill="#ff0000"/>`,
    OMA:(p)=>`<rect x="30" width="90" height="40" fill="#fff"/><rect x="30" y="40" width="90" height="40" fill="#d71920"/><rect x="30" y="80" width="90" height="40" fill="#008000"/><rect width="30" height="120" fill="#d71920"/>`,
    NAM:(p)=>`<rect width="120" height="120" fill="#003580"/><path d="M-20 107L105-18h35L15 107z" fill="#d21034"/><path d="M-7 120L120-7v18L11 120z" fill="#fff"/><path d="M29 22a14 14 0 1 1 0 28 14 14 0 0 1 0-28" fill="#ffce00"/>`,
    PNG:(p)=>`<path d="M0 0h120L0 120z" fill="#ce1126"/><path d="M120 0v120H0z" fill="#000"/><path d="M71 29c13 4 22 13 28 27-15-8-25-7-35 2 6-13 8-21 7-29z" fill="#ffd100"/><circle cx="31" cy="84" r="4" fill="#fff"/><circle cx="48" cy="94" r="3" fill="#fff"/>`,
  };

  function generic(p){
    const a=p.primary||'#3a566e', b=p.secondary||'#1b2733';
    return `<rect width="120" height="120" fill="${esc(a)}"/><path d="M0 88L88 0h32v32L32 120H0z" fill="${esc(b)}" opacity=".9"/><circle cx="60" cy="60" r="37" fill="#09111b" opacity=".72"/><circle cx="60" cy="60" r="32" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="2"/><path d="M37 72c12 10 34 10 46 0" fill="none" stroke="#fff" stroke-opacity=".48" stroke-width="3" stroke-linecap="round"/>`;
  }

  window.teamMarkSvg = function(info){
    const p = info || {code:'CR',primary:'#3a566e',secondary:'#1b2733'};
    const code = String(p.code||'CR').toUpperCase();
    const inner=(patterns[code]||generic)(p);
    const needsCode=!patterns[code];
    return `<svg viewBox="0 0 120 120" role="img" aria-label="${esc(p.name||code)} team mark" xmlns="http://www.w3.org/2000/svg">
      <defs><clipPath id="clip-${esc(code)}"><circle cx="60" cy="60" r="53"/></clipPath><filter id="sh-${esc(code)}" x="-30%" y="-30%" width="160%" height="160%"><feDropShadow dx="0" dy="5" stdDeviation="5" flood-opacity=".32"/></filter></defs>
      <circle cx="60" cy="60" r="57" fill="#f3f6f9" filter="url(#sh-${esc(code)})"/>
      <g clip-path="url(#clip-${esc(code)})">${inner}${needsCode?`<text x="60" y="68" text-anchor="middle" font-family="Arial,Helvetica,sans-serif" font-size="23" font-weight="900" fill="#fff">${esc(code)}</text>`:''}</g>
      <circle cx="60" cy="60" r="54" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width="4"/>
      <circle cx="60" cy="60" r="57" fill="none" stroke="#000" stroke-opacity=".18" stroke-width="1"/>
    </svg>`;
  };
})();
