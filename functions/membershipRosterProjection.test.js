const fs = require('node:fs');
const path = require('node:path');

const {
  membershipRosterSchemaVersion,
  MembershipRosterColumnProfile,
  MEMBERSHIP_ROSTER_COLUMN_PROFILES,
  MembershipRosterProjectionError,
  projectMembershipRosterCsv,
} = require('./membershipRosterProjection');

const VALID_ASOF = '2026-07-21T00:00:00Z';

function request(overrides = {}) {
  return {
    membershipRosterSchemaVersion: 1,
    columnProfile: 'officer_standard',
    asOf: VALID_ASOF,
    rows: [],
    ...overrides,
  };
}

// A synthetic member row. Values are obviously fabricated; no real member data.
function memberRow(overrides = {}) {
  return {
    memberRef: 'mbr_0001',
    displayName: 'Alex Runner',
    membershipStatus: 'current',
    planName: 'annual_standard',
    termStartsOn: '2026-01-01',
    termEndsOn: '2026-12-31',
    ...overrides,
  };
}

// A minimal RFC 4180 parser used only to prove the serializer's output has
// intact structure: quoted fields, doubled quotes, embedded commas/newlines,
// and CRLF record separators all round-trip. Returns an array of records, each
// an array of decoded field strings.
function parseCsv(text) {
  const records = [];
  let record = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i += 1; continue;
      }
      field += ch; i += 1; continue;
    }
    if (ch === '"') { inQuotes = true; i += 1; continue; }
    if (ch === ',') { record.push(field); field = ''; i += 1; continue; }
    if (ch === '\r' && text[i + 1] === '\n') {
      record.push(field); records.push(record); record = []; field = ''; i += 2; continue;
    }
    if (ch === '\n' || ch === '\r') {
      record.push(field); records.push(record); record = []; field = ''; i += 1; continue;
    }
    field += ch; i += 1;
  }
  record.push(field);
  records.push(record);
  return records;
}

describe('frozen, versioned surface', () => {
  test('schema version is the frozen literal 1', () => {
    expect(membershipRosterSchemaVersion).toBe(1);
  });

  test('column profile enum and profile registry are frozen', () => {
    expect(Object.isFrozen(MembershipRosterColumnProfile)).toBe(true);
    expect(Object.isFrozen(MEMBERSHIP_ROSTER_COLUMN_PROFILES)).toBe(true);
    for (const columns of Object.values(MEMBERSHIP_ROSTER_COLUMN_PROFILES)) {
      expect(Object.isFrozen(columns)).toBe(true);
    }
  });

  test('enum values match the registry keys', () => {
    expect(new Set(Object.values(MembershipRosterColumnProfile)))
      .toEqual(new Set(Object.keys(MEMBERSHIP_ROSTER_COLUMN_PROFILES)));
  });

  test('module export object is frozen', () => {
    const mod = require('./membershipRosterProjection');
    expect(Object.isFrozen(mod)).toBe(true);
  });

  test('every seed column name is a safe non-sensitive identifier', () => {
    const columnPattern = /^[a-z][A-Za-z0-9]*$/;
    for (const columns of Object.values(MEMBERSHIP_ROSTER_COLUMN_PROFILES)) {
      for (const column of columns) {
        expect(column).toMatch(columnPattern);
      }
    }
  });
});

describe('happy path — valid export produces a structured CSV artifact', () => {
  test('header plus one data row, minimized to the selected profile', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_standard',
      rows: [memberRow()],
    }));

    expect(Object.isFrozen(artifact)).toBe(true);
    expect(artifact.membershipRosterSchemaVersion).toBe(1);
    expect(artifact.columnProfile).toBe('officer_standard');
    expect(artifact.columns).toEqual(MEMBERSHIP_ROSTER_COLUMN_PROFILES.officer_standard);
    expect(Object.isFrozen(artifact.columns)).toBe(true);
    expect(artifact.asOf).toBe(VALID_ASOF);
    expect(artifact.rowCount).toBe(1);
    expect(artifact.characterLength).toBe(artifact.csv.length);

    const parsed = parseCsv(artifact.csv);
    expect(parsed).toHaveLength(2); // header + one row
    expect(parsed[0]).toEqual(MEMBERSHIP_ROSTER_COLUMN_PROFILES.officer_standard);
    expect(parsed[1]).toEqual([
      'mbr_0001', 'Alex Runner', 'current', 'annual_standard', '2026-01-01', '2026-12-31',
    ]);
  });

  test('rowCount equals the number of input rows and CSV data lines', () => {
    const rows = [memberRow(), memberRow({ memberRef: 'mbr_0002' }), memberRow({ memberRef: 'mbr_0003' })];
    const artifact = projectMembershipRosterCsv(request({ rows }));
    expect(artifact.rowCount).toBe(3);
    const parsed = parseCsv(artifact.csv);
    expect(parsed).toHaveLength(4);
    for (const record of parsed) {
      expect(record).toHaveLength(MEMBERSHIP_ROSTER_COLUMN_PROFILES.officer_standard.length);
    }
  });

  test('empty roster yields a header-only artifact with zero rows', () => {
    const artifact = projectMembershipRosterCsv(request({ rows: [] }));
    expect(artifact.rowCount).toBe(0);
    const parsed = parseCsv(artifact.csv);
    expect(parsed).toHaveLength(1);
    expect(parsed[0]).toEqual(MEMBERSHIP_ROSTER_COLUMN_PROFILES.officer_standard);
    expect(artifact.csv.includes('\r\n')).toBe(false);
  });

  test('records are separated by CRLF', () => {
    const artifact = projectMembershipRosterCsv(request({ rows: [memberRow()] }));
    expect(artifact.csv).toContain('\r\n');
    expect(artifact.csv.split('\r\n')).toHaveLength(2);
  });
});

describe('column allowlist — only profile columns appear, extras are dropped', () => {
  test('a non-profile key on a row never reaches the output', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_standard',
      rows: [memberRow({
        notOnProfile: 'DROP-ME-synthetic',
        emergencyContact: 'synthetic-excluded-value',
        internalAuditNote: 'synthetic-note',
      })],
    }));
    for (const leaked of ['DROP-ME-synthetic', 'synthetic-excluded-value', 'synthetic-note',
      'notOnProfile', 'emergencyContact', 'internalAuditNote']) {
      expect(artifact.csv).not.toContain(leaked);
    }
    const parsed = parseCsv(artifact.csv);
    expect(parsed[1]).toHaveLength(6);
  });

  test('minimal profile emits only its three columns, dropping the rest', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow()],
    }));
    expect(artifact.columns).toEqual(['memberRef', 'displayName', 'membershipStatus']);
    const parsed = parseCsv(artifact.csv);
    expect(parsed[0]).toEqual(['memberRef', 'displayName', 'membershipStatus']);
    expect(parsed[1]).toEqual(['mbr_0001', 'Alex Runner', 'current']);
    // planName / term values are present on the row but excluded by the profile.
    expect(artifact.csv).not.toContain('annual_standard');
    expect(artifact.csv).not.toContain('2026-12-31');
  });

  test('a sensitive field added to the source later is still excluded', () => {
    // Simulate a source record that gains an unapproved field after the fact.
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ futureSensitiveField: 'must-not-appear' })],
    }));
    expect(artifact.csv).not.toContain('must-not-appear');
    expect(artifact.csv).not.toContain('futureSensitiveField');
  });

  test('a missing approved column becomes an empty cell, not an error', () => {
    const partial = memberRow();
    delete partial.planName;
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_standard',
      rows: [partial],
    }));
    const parsed = parseCsv(artifact.csv);
    expect(parsed[1][3]).toBe(''); // planName column, empty
    expect(parsed[1][0]).toBe('mbr_0001');
  });

  test('an unknown column profile is rejected', () => {
    expect(() => projectMembershipRosterCsv(request({ columnProfile: 'admin_full' })))
      .toThrow(MembershipRosterProjectionError);
    expect(() => projectMembershipRosterCsv(request({ columnProfile: '' })))
      .toThrow(MembershipRosterProjectionError);
  });
});

describe('CSV structural safety — quoting keeps rows intact', () => {
  test('a comma in a value does not create an extra column', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: 'Smith, Jr.' })],
    }));
    const parsed = parseCsv(artifact.csv);
    expect(parsed[1]).toHaveLength(3);
    expect(parsed[1][1]).toBe('Smith, Jr.');
  });

  test('a double-quote in a value is escaped and round-trips', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: 'The "Fast" Runner' })],
    }));
    expect(artifact.csv).toContain('""Fast""');
    const parsed = parseCsv(artifact.csv);
    expect(parsed[1][1]).toBe('The "Fast" Runner');
  });

  test('an embedded newline stays inside one quoted field', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: 'line one\nline two' })],
    }));
    const parsed = parseCsv(artifact.csv);
    expect(parsed).toHaveLength(2); // still just header + one record
    expect(parsed[1][1]).toBe('line one\nline two');
  });

  test('every field is quoted', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow()],
    }));
    for (const line of artifact.csv.split('\r\n')) {
      expect(line.startsWith('"')).toBe(true);
      expect(line.endsWith('"')).toBe(true);
    }
  });
});

describe('spreadsheet formula-injection neutralization (CWE-1236)', () => {
  const dangerous = [
    ['=SUM(A1:A2)', "'=SUM(A1:A2)"],
    ['+1+1', "'+1+1"],
    ['-2+3', "'-2+3"],
    ['@INDIRECT("x")', '\'@INDIRECT("x")'],
    ['\tTAB-led', "'\tTAB-led"],
    ['\rCR-led', "'\rCR-led"],
  ];

  test.each(dangerous)('a cell beginning with a trigger is prefixed with an apostrophe: %j', (input, expected) => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: input })],
    }));
    const parsed = parseCsv(artifact.csv);
    expect(parsed[1][1]).toBe(expected);
  });

  test('a benign value that merely contains a formula char is not altered', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: 'A-Team = best' })],
    }));
    const parsed = parseCsv(artifact.csv);
    expect(parsed[1][1]).toBe('A-Team = best'); // no leading apostrophe added
  });

  test('a neutralized formula cell still round-trips as text', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ membershipStatus: '=1+1' })],
    }));
    const parsed = parseCsv(artifact.csv);
    expect(parsed[1][2]).toBe("'=1+1");
    expect(parsed[1]).toHaveLength(3);
  });
});

describe('cell content safety — dangerous characters rejected, safe ones handled', () => {
  const rejectedChars = [
    ['NUL', ' '],
    ['C0 vertical tab', ''],
    ['C0 form feed', ''],
    ['C0 SOH', ''],
    ['DEL', ''],
    ['C1 control', ''],
    ['line separator U+2028', ' '],
    ['paragraph separator U+2029', ' '],
  ];

  test.each(rejectedChars)('rejects a %s in a cell value', (_label, ch) => {
    expect(() => projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: `ok${ch}bad` })],
    }))).toThrow(MembershipRosterProjectionError);
  });

  test('allows tab, LF, and CR inside a quoted cell', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: 'a\tb\nc\rd' })],
    }));
    const parsed = parseCsv(artifact.csv);
    // The lone CR the parser sees is inside the quoted field, so it stays.
    expect(parsed[1][1].includes('\t')).toBe(true);
  });

  test('rejects an over-length cell value', () => {
    const huge = 'x'.repeat(4097);
    expect(() => projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: huge })],
    }))).toThrow(MembershipRosterProjectionError);
  });

  test('accepts a cell value at exactly the length bound', () => {
    const atBound = 'x'.repeat(4096);
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ displayName: atBound })],
    }));
    expect(parseCsv(artifact.csv)[1][1]).toBe(atBound);
  });

  test('rejects a non-string, non-null present cell value', () => {
    for (const bad of [42, true, {}, [], Symbol('x')]) {
      expect(() => projectMembershipRosterCsv(request({
        columnProfile: 'officer_minimal',
        rows: [memberRow({ displayName: bad })],
      }))).toThrow(MembershipRosterProjectionError);
    }
  });

  test('an explicit null value becomes an empty cell', () => {
    const artifact = projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [memberRow({ membershipStatus: null })],
    }));
    expect(parseCsv(artifact.csv)[1][2]).toBe('');
  });
});

describe('bounds — row count, row width, and total size', () => {
  test('rejects more rows than the maximum', () => {
    // A genuine array over the bound; the length check fires before any element
    // read, so the holes are never reached.
    const rows = new Array(20001);
    expect(() => projectMembershipRosterCsv(request({ rows })))
      .toThrow(MembershipRosterProjectionError);
  });

  test('rejects a row with more keys than the per-row maximum', () => {
    const wide = {};
    for (let i = 0; i < 257; i += 1) wide[`k${i}`] = 'v';
    expect(() => projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [wide],
    }))).toThrow(MembershipRosterProjectionError);
  });

  test('rejects when the assembled CSV exceeds the total-size bound', () => {
    const bigCell = 'x'.repeat(4096);
    const rows = [];
    // ~9.8M characters of CSV once quoted, comfortably over the 8M ceiling.
    for (let i = 0; i < 800; i += 1) {
      rows.push({ memberRef: bigCell, displayName: bigCell, membershipStatus: bigCell });
    }
    expect(() => projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows,
    }))).toThrow(MembershipRosterProjectionError);
  });
});

describe('rows array — hostile shapes rejected without invoking getters', () => {
  test('rejects a non-array rows value', () => {
    for (const bad of [null, undefined, {}, 'rows', 42, { length: 1, 0: memberRow() }]) {
      expect(() => projectMembershipRosterCsv(request({ rows: bad })))
        .toThrow(MembershipRosterProjectionError);
    }
  });

  test('rejects a rows array containing a hole', () => {
    const rows = [memberRow()];
    rows[2] = memberRow(); // index 1 is a hole
    expect(() => projectMembershipRosterCsv(request({ rows })))
      .toThrow(MembershipRosterProjectionError);
  });

  test('rejects a rows array with an accessor element without invoking it', () => {
    const rows = [memberRow()];
    let invoked = false;
    Object.defineProperty(rows, '1', {
      enumerable: true,
      configurable: true,
      get() { invoked = true; return memberRow(); },
    });
    Object.defineProperty(rows, 'length', { value: 2 });
    expect(() => projectMembershipRosterCsv(request({ rows })))
      .toThrow(MembershipRosterProjectionError);
    expect(invoked).toBe(false);
  });

  test('rejects a rows array carrying a stray non-index own key', () => {
    const rows = [memberRow()];
    rows.injected = memberRow();
    expect(() => projectMembershipRosterCsv(request({ rows })))
      .toThrow(MembershipRosterProjectionError);
  });

  test('rejects a proxied rows array', () => {
    const rows = new Proxy([memberRow()], {});
    expect(() => projectMembershipRosterCsv(request({ rows })))
      .toThrow(MembershipRosterProjectionError);
  });
});

describe('row objects — hostile shapes rejected without invoking getters', () => {
  test('rejects a non-object row element', () => {
    for (const bad of [null, 'row', 42, true]) {
      expect(() => projectMembershipRosterCsv(request({ rows: [bad] })))
        .toThrow(MembershipRosterProjectionError);
    }
  });

  test('rejects a proxied row', () => {
    expect(() => projectMembershipRosterCsv(request({ rows: [new Proxy(memberRow(), {})] })))
      .toThrow(MembershipRosterProjectionError);
  });

  test('rejects a row with an accessor column without invoking the getter', () => {
    let invoked = false;
    const row = memberRow();
    Object.defineProperty(row, 'displayName', {
      enumerable: true,
      configurable: true,
      get() { invoked = true; return 'leaked'; },
    });
    expect(() => projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [row],
    }))).toThrow(MembershipRosterProjectionError);
    expect(invoked).toBe(false);
  });

  test('rejects a row whose data lives on the prototype', () => {
    const row = Object.create({ memberRef: 'inherited', displayName: 'inherited', membershipStatus: 'x' });
    expect(() => projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [row],
    }))).toThrow(MembershipRosterProjectionError);
  });

  test('rejects a null-prototype row', () => {
    const row = Object.assign(Object.create(null), memberRow());
    expect(() => projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [row],
    }))).toThrow(MembershipRosterProjectionError);
  });

  test('rejects a row with a non-enumerable own column', () => {
    const row = memberRow();
    Object.defineProperty(row, 'displayName', {
      value: 'hidden', enumerable: false, writable: true, configurable: true,
    });
    expect(() => projectMembershipRosterCsv(request({
      columnProfile: 'officer_minimal',
      rows: [row],
    }))).toThrow(MembershipRosterProjectionError);
  });
});

describe('export request envelope — malformed and hostile inputs rejected', () => {
  test('rejects non-object input', () => {
    for (const bad of [null, undefined, 'x', 42, true, []]) {
      expect(() => projectMembershipRosterCsv(bad)).toThrow(MembershipRosterProjectionError);
    }
  });

  test('rejects an extra key', () => {
    expect(() => projectMembershipRosterCsv({ ...request(), extra: 1 }))
      .toThrow(MembershipRosterProjectionError);
  });

  test('rejects a missing key', () => {
    const base = request();
    delete base.asOf;
    expect(() => projectMembershipRosterCsv(base)).toThrow(MembershipRosterProjectionError);
  });

  test('rejects a wrong schema version', () => {
    expect(() => projectMembershipRosterCsv(request({ membershipRosterSchemaVersion: 2 })))
      .toThrow(MembershipRosterProjectionError);
    expect(() => projectMembershipRosterCsv(request({ membershipRosterSchemaVersion: '1' })))
      .toThrow(MembershipRosterProjectionError);
  });

  test('rejects a malformed asOf timestamp', () => {
    for (const bad of ['2026-07-21', '2026-07-21T00:00:00', '2026-13-01T00:00:00Z', 'now', 12345, null]) {
      expect(() => projectMembershipRosterCsv(request({ asOf: bad })))
        .toThrow(MembershipRosterProjectionError);
    }
  });

  test('rejects a proxied envelope', () => {
    expect(() => projectMembershipRosterCsv(new Proxy(request(), {})))
      .toThrow(MembershipRosterProjectionError);
  });

  test('rejects an envelope with an accessor field without invoking it', () => {
    let invoked = false;
    const base = request();
    delete base.asOf;
    Object.defineProperty(base, 'asOf', {
      enumerable: true, configurable: true, get() { invoked = true; return VALID_ASOF; },
    });
    expect(() => projectMembershipRosterCsv(base)).toThrow(MembershipRosterProjectionError);
    expect(invoked).toBe(false);
  });

  test('rejects an envelope whose keys are inherited', () => {
    const base = Object.create(request());
    expect(() => projectMembershipRosterCsv(base)).toThrow(MembershipRosterProjectionError);
  });

  test('rejects a null-prototype envelope', () => {
    const base = Object.assign(Object.create(null), request());
    expect(() => projectMembershipRosterCsv(base)).toThrow(MembershipRosterProjectionError);
  });
});

describe('error identity and determinism', () => {
  test('the thrown error is a frozen typed error that does not echo input', () => {
    let caught;
    try {
      projectMembershipRosterCsv(request({ columnProfile: 'SECRETPROFILE-xyz' }));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(MembershipRosterProjectionError);
    expect(caught.name).toBe('MembershipRosterProjectionError');
    expect(caught.code).toBe('invalid_membership_roster_evidence');
    expect(caught.message).not.toContain('SECRETPROFILE');
    expect(Object.isFrozen(caught)).toBe(true);
  });

  test('the same request produces byte-identical CSV', () => {
    const rows = [memberRow(), memberRow({ memberRef: 'mbr_0002', displayName: 'Bee, "B"' })];
    const a = projectMembershipRosterCsv(request({ rows }));
    const b = projectMembershipRosterCsv(request({ rows }));
    expect(a.csv).toBe(b.csv);
    expect(a.characterLength).toBe(b.characterLength);
  });
});

describe('source boundary — the module is a pure, provider-neutral, unused contract', () => {
  const source = fs.readFileSync(path.join(__dirname, 'membershipRosterProjection.js'), 'utf8');

  // These guarantees are about executable code, not documentation. The header
  // comment names the issue tracker and, in prose, the categories of field the
  // allowlist deliberately excludes; strip comments before the code batteries.
  function codeOnly(text) {
    return text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/gm, '$1');
  }
  const code = codeOnly(source);

  test('comment stripping preserves code and removes prose', () => {
    expect(code).toContain('projectMembershipRosterCsv');
    expect(code).not.toContain('CWE-1236');
  });

  test.each([
    /process\.env/, /Date\.now/, /new Date/, /Math\.random/, /console\./,
    /fetch\(/, /https?:/, /firebase/i, /firestore/i, /stripe/i,
  ])('code uses no ambient/IO/provider API: %s', (pattern) => {
    expect(pattern.test(code)).toBe(false);
  });

  test.each([/instagram/i, /facebook/i])('code is provider-neutral: %s', (pattern) => {
    expect(pattern.test(code)).toBe(false);
  });

  test.each([
    /phone/i, /address/i, /\bdob\b/i, /\bssn\b/i, /secret/i,
    /\btoken\b/i, /password/i, /bearer/i, /api[_-]?key/i,
  ])('code names no PII/credential field: %s', (pattern) => {
    expect(pattern.test(code)).toBe(false);
  });

  test('the module requires only node:util', () => {
    const requires = [...code.matchAll(/require\(\s*'([^']+)'\s*\)/g)].map((m) => m[1]);
    expect(requires.length).toBeGreaterThan(0);
    for (const target of requires) {
      expect(target).toBe('node:util');
    }
  });

  test('the raw source names the issue and the versioned surface', () => {
    expect(source).toContain('MEMBERS-ROSTER-001A');
    expect(source).toContain('membershipRosterSchemaVersion');
    expect(source).toContain("require('node:util')");
  });

  test('no runtime module imports this contract', () => {
    const indexPath = path.join(__dirname, 'index.js');
    const index = fs.readFileSync(indexPath, 'utf8');
    expect(index).not.toContain('membershipRosterProjection');
  });
});
