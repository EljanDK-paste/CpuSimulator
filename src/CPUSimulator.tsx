import { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  StepForward,
  RotateCcw,
  PenLine,
  Cpu,
} from "lucide-react";

/* Every operand is checked when the program is loaded, so the execute step can
   trust that a "reg" really is R0-R3 and an "addr" is inside Data Memory. */
type OperandKind = "reg" | "imm" | "addr" | "target";

type OpKind =
  | "reg"
  | "mem-read"
  | "mem-write"
  | "alu"
  | "alu-cmp"
  | "jump"
  | "jumpz"
  | "halt";

type OpInfo = {
  operands: OperandKind[];
  kind: OpKind;
  desc: (a: string[]) => string;
};

const OPCODES = {
  LOADI: {
    operands: ["reg", "imm"],
    kind: "reg",
    desc: (a) => `Load immediate value ${a[1]} into ${a[0]}`,
  },
  LOAD: {
    operands: ["reg", "addr"],
    kind: "mem-read",
    desc: (a) => `Load Data Memory[${a[1]}] into ${a[0]}`,
  },
  STORE: {
    operands: ["reg", "addr"],
    kind: "mem-write",
    desc: (a) => `Store ${a[0]} into Data Memory[${a[1]}]`,
  },
  ADD: {
    operands: ["reg", "reg", "reg"],
    kind: "alu",
    desc: (a) => `Add ${a[1]} + ${a[2]} → ${a[0]}`,
  },
  SUB: {
    operands: ["reg", "reg", "reg"],
    kind: "alu",
    desc: (a) => `Subtract ${a[1]} − ${a[2]} → ${a[0]}`,
  },
  MUL: {
    operands: ["reg", "reg", "reg"],
    kind: "alu",
    desc: (a) => `Multiply ${a[1]} × ${a[2]} → ${a[0]}`,
  },
  CMP: {
    operands: ["reg", "reg"],
    kind: "alu-cmp",
    desc: (a) => `Compare ${a[0]} and ${a[1]}, set zero flag`,
  },
  JMP: {
    operands: ["target"],
    kind: "jump",
    desc: (a) => `Jump to instruction ${a[0]}`,
  },
  JZ: {
    operands: ["target"],
    kind: "jumpz",
    desc: (a) => `If zero flag is set, jump to instruction ${a[0]}`,
  },
  HALT: { operands: [], kind: "halt", desc: () => `Stop execution` },
} satisfies Record<string, OpInfo>;

type Opcode = keyof typeof OPCODES;

function isOpcode(s: string): s is Opcode {
  return Object.hasOwn(OPCODES, s);
}

type RegName = "R0" | "R1" | "R2" | "R3";
type Registers = Record<RegName, number>;

const REG_NAMES: RegName[] = ["R0", "R1", "R2", "R3"];
const MEM_SIZE = 16;

function isRegName(s: string): s is RegName {
  return (REG_NAMES as string[]).includes(s);
}

/* Operands are validated at load time; these keep execution total if anything
   ever slips through. */
function asReg(a: string | undefined): RegName {
  return a !== undefined && isRegName(a) ? a : "R0";
}

function asInt(a: string | undefined): number {
  const n = Number.parseInt(a ?? "", 10);
  return Number.isFinite(n) ? n : 0;
}

type Instruction = {
  raw: string;
  op: Opcode;
  args: string[];
  line: number;
};

const DEFAULT_PROGRAM = `# Multiply two values and store the result
LOADI R0, 6
LOADI R1, 7
MUL R2, R0, R1
STORE R2, 10
LOAD R3, 10
CMP R3, R2
HALT`;

const PRESETS: Record<string, string> = {
  "Multiply & store": DEFAULT_PROGRAM,
  "Add & compare": `LOADI R0, 4
LOADI R1, 4
ADD R2, R0, R1
CMP R0, R1
HALT`,
};

function checkOperand(kind: OperandKind, arg: string, line: number) {
  const asNumber = () => {
    if (!/^-?\d+$/.test(arg)) {
      throw new Error(`Line ${line}: "${arg}" is not a whole number`);
    }
    return Number.parseInt(arg, 10);
  };

  switch (kind) {
    case "reg":
      if (!isRegName(arg)) {
        throw new Error(`Line ${line}: "${arg}" is not a register (use R0–R3)`);
      }
      return;
    case "imm":
      asNumber();
      return;
    case "addr": {
      const a = asNumber();
      if (a < 0 || a >= MEM_SIZE) {
        throw new Error(
          `Line ${line}: memory address ${a} is out of range (0–${MEM_SIZE - 1})`,
        );
      }
      return;
    }
    case "target":
      asNumber();
      return;
  }
}

function parseProgram(text: string): Instruction[] {
  const lines = text.split("\n");
  const instrs: Instruction[] = [];
  lines.forEach((raw, i) => {
    const line = raw.split("#")[0].split("//")[0].trim();
    if (!line) return;
    const spaceIdx = line.indexOf(" ");
    const rawOp = spaceIdx === -1 ? line : line.slice(0, spaceIdx);
    const rest = spaceIdx === -1 ? "" : line.slice(spaceIdx + 1);
    const op = rawOp.toUpperCase().trim();
    const args = rest
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
      .map((s) => (/^R\d+$/i.test(s) ? s.toUpperCase() : s));
    if (!isOpcode(op))
      throw new Error(`Line ${i + 1}: unknown instruction "${op}"`);
    const info: OpInfo = OPCODES[op];
    if (args.length !== info.operands.length) {
      throw new Error(
        `Line ${i + 1}: ${op} expects ${info.operands.length} operand(s), got ${args.length}`,
      );
    }
    info.operands.forEach((kind, k) => checkOperand(kind, args[k], i + 1));
    instrs.push({ raw: line, op, args, line: i + 1 });
  });
  if (instrs.length === 0) throw new Error("Program is empty.");

  // Jump targets can only be checked once the whole program is known.
  instrs.forEach((instr) => {
    const info: OpInfo = OPCODES[instr.op];
    info.operands.forEach((kind, k) => {
      if (kind !== "target") return;
      const target = Number.parseInt(instr.args[k], 10);
      if (target < 0 || target >= instrs.length) {
        throw new Error(
          `Line ${instr.line}: jump target ${target} is out of range (0–${instrs.length - 1})`,
        );
      }
    });
  });

  return instrs;
}

type Active = {
  pc: boolean;
  ir: boolean;
  cu: boolean;
  alu: boolean;
  zf: boolean;
  regsRead: RegName[];
  regsWrite: RegName[];
  memRead: number[];
  memWrite: number[];
};

function emptyActive(): Active {
  return {
    pc: false,
    ir: false,
    cu: false,
    alu: false,
    zf: false,
    regsRead: [],
    regsWrite: [],
    memRead: [],
    memWrite: [],
  };
}

type Phase = "idle" | "fetch" | "decode" | "execute" | "halted";

const PHASE_META: Record<Phase, { label: string }> = {
  idle: { label: "Ready" },
  fetch: { label: "Fetch" },
  decode: { label: "Decode" },
  execute: { label: "Execute" },
  halted: { label: "Halted" },
};

const CYCLE_STEPS = ["fetch", "decode", "execute"] as const;

type LogEntry = { step: number; component: string; detail: string };

const STEP_INTERVAL_MS = 750;

export default function CPUSimulator() {
  const [draft, setDraft] = useState(DEFAULT_PROGRAM);
  const [editing, setEditing] = useState(true);
  const [program, setProgram] = useState<Instruction[]>([]);
  const [error, setError] = useState("");

  const [pc, setPc] = useState(0);
  const [fetchedIdx, setFetchedIdx] = useState<number | null>(null);
  const [registers, setRegisters] = useState<Registers>({
    R0: 0,
    R1: 0,
    R2: 0,
    R3: 0,
  });
  const [memory, setMemory] = useState<number[]>(Array(MEM_SIZE).fill(0));
  const [zeroFlag, setZeroFlag] = useState(false);
  const [ir, setIr] = useState<Instruction | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState<Active>(emptyActive());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [running, setRunning] = useState(false);
  const [spotlight, setSpotlight] = useState(
    "Load a program, then press Step to begin.",
  );

  const logEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [log]);

  /* The step number is derived from the previous entry rather than the array
     length, so it keeps counting after the 200-entry window slides. */
  function pushLog(component: string, detail: string) {
    setLog((l) => {
      const step = l.length === 0 ? 0 : l[l.length - 1].step + 1;
      return [...l, { step, component, detail }].slice(-200);
    });
    setSpotlight(detail);
  }

  function resetState(message: string) {
    setPc(0);
    setFetchedIdx(null);
    setRegisters({ R0: 0, R1: 0, R2: 0, R3: 0 });
    setMemory(Array(MEM_SIZE).fill(0));
    setZeroFlag(false);
    setIr(null);
    setPhase("idle");
    setActive(emptyActive());
    setLog([{ step: 0, component: "System", detail: message }]);
    setSpotlight(message);
    setRunning(false);
  }

  function loadProgram() {
    try {
      const parsed = parseProgram(draft);
      setProgram(parsed);
      setError("");
      setEditing(false);
      resetState("Program loaded. Press Step or Run to begin.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function doStep() {
    if (!program.length || phase === "halted") return;

    if (phase === "idle") {
      if (pc >= program.length) {
        setPhase("halted");
        setActive(emptyActive());
        pushLog(
          "Control Unit",
          "Program counter past end of program — execution halted.",
        );
        setRunning(false);
        return;
      }
      const instr = program[pc];
      const nextPc = pc + 1;
      setFetchedIdx(pc);
      setIr(instr);
      setPc(nextPc);
      setActive({ ...emptyActive(), pc: true, ir: true, cu: true });
      pushLog(
        "Control Unit",
        `Fetch: read instruction ${pc + 1} ("${instr.raw}") into IR; PC → ${nextPc + 1}`,
      );
      setPhase("fetch");
      return;
    }

    if (phase === "fetch") {
      if (!ir) return;
      setActive({ ...emptyActive(), ir: true, cu: true });
      pushLog("Control Unit", `Decode: ${OPCODES[ir.op].desc(ir.args)}`);
      setPhase("decode");
      return;
    }

    if (phase === "decode") {
      if (ir) executeInstruction(ir);
      return;
    }

    if (phase === "execute") {
      setPhase("idle");
      setActive(emptyActive());
    }
  }

  function executeInstruction(instr: Instruction) {
    const { op, args } = instr;
    const info: OpInfo = OPCODES[op];
    let nextActive = emptyActive();
    const regs: Registers = { ...registers };
    const mem = [...memory];
    let zf = zeroFlag;
    let jumpTo: number | null = null;
    let detail = "";

    switch (info.kind) {
      case "reg": {
        const rd = asReg(args[0]);
        const imm = asInt(args[1]);
        regs[rd] = imm;
        nextActive = { ...emptyActive(), cu: true, regsWrite: [rd] };
        detail = `Registers: ${rd} ← ${imm}`;
        break;
      }
      case "mem-read": {
        const rd = asReg(args[0]);
        const a = asInt(args[1]);
        regs[rd] = mem[a] ?? 0;
        nextActive = {
          ...emptyActive(),
          cu: true,
          memRead: [a],
          regsWrite: [rd],
        };
        detail = `Registers ← Data Memory: ${rd} ← Memory[${a}] (${mem[a] ?? 0})`;
        break;
      }
      case "mem-write": {
        const rs = asReg(args[0]);
        const a = asInt(args[1]);
        mem[a] = regs[rs];
        nextActive = {
          ...emptyActive(),
          cu: true,
          regsRead: [rs],
          memWrite: [a],
        };
        detail = `Data Memory ← Registers: Memory[${a}] ← ${rs} (${regs[rs]})`;
        break;
      }
      case "alu": {
        const rd = asReg(args[0]);
        const r1 = asReg(args[1]);
        const r2 = asReg(args[2]);
        const v1 = regs[r1];
        const v2 = regs[r2];
        const result =
          op === "ADD" ? v1 + v2 : op === "SUB" ? v1 - v2 : v1 * v2;
        regs[rd] = result;
        nextActive = {
          ...emptyActive(),
          alu: true,
          regsRead: [r1, r2],
          regsWrite: [rd],
        };
        detail = `ALU: ${v1} ${op === "ADD" ? "+" : op === "SUB" ? "−" : "×"} ${v2} = ${result} → ${rd}`;
        break;
      }
      case "alu-cmp": {
        const r1 = asReg(args[0]);
        const r2 = asReg(args[1]);
        zf = regs[r1] === regs[r2];
        nextActive = {
          ...emptyActive(),
          alu: true,
          zf: true,
          regsRead: [r1, r2],
        };
        detail = `ALU: compare ${r1} (${regs[r1]}) and ${r2} (${regs[r2]}) → zero flag = ${zf}`;
        break;
      }
      case "jump": {
        jumpTo = asInt(args[0]);
        nextActive = { ...emptyActive(), cu: true, pc: true };
        detail = `Control Unit: unconditional jump → instruction ${jumpTo + 1}`;
        break;
      }
      case "jumpz": {
        nextActive = { ...emptyActive(), cu: true, pc: true, zf: true };
        if (zf) {
          jumpTo = asInt(args[0]);
          detail = `Control Unit: zero flag set → jump to instruction ${jumpTo + 1}`;
        } else {
          detail = `Control Unit: zero flag not set → continue to instruction ${pc + 1}`;
        }
        break;
      }
      case "halt": {
        nextActive = { ...emptyActive(), cu: true };
        detail = "Control Unit: HALT — execution stopped";
        break;
      }
    }

    setRegisters(regs);
    setMemory(mem);
    setZeroFlag(zf);
    setActive(nextActive);
    pushLog(componentLabel(info.kind), detail);

    if (info.kind === "halt") {
      setPhase("halted");
      setRunning(false);
      setActive(emptyActive());
      return;
    }
    if (jumpTo !== null) {
      if (jumpTo < 0 || jumpTo >= program.length) {
        pushLog(
          "Control Unit",
          `Jump target ${jumpTo + 1} is out of range — execution halted.`,
        );
        setPhase("halted");
        setRunning(false);
        setActive(emptyActive());
        return;
      }
      setPc(jumpTo);
    }
    setPhase("execute");
  }

  function componentLabel(kind: OpKind) {
    if (kind === "alu" || kind === "alu-cmp") return "ALU";
    if (kind === "mem-read" || kind === "mem-write") return "Data Memory";
    if (kind === "reg") return "Registers";
    return "Control Unit";
  }

  /* The auto-run timer reads the latest doStep through a ref so the effect can
     depend on the cycle state instead of re-arming on every render. */
  const stepRef = useRef(doStep);
  useEffect(() => {
    stepRef.current = doStep;
  });

  useEffect(() => {
    // Every path that halts also clears `running`, so this only has to bail out.
    if (!running || phase === "halted") return;
    const t = setTimeout(() => stepRef.current(), STEP_INTERVAL_MS);
    return () => clearTimeout(t);
  }, [running, phase, pc]);

  const halted = phase === "halted";
  const displayLine = fetchedIdx !== null ? fetchedIdx : -1;
  const meta = PHASE_META[phase];
  const memActive = active.memRead.length > 0 || active.memWrite.length > 0;

  return (
    <div className="cs-app">
      <header className="cs-header">
        <div className="cs-header-left">
          <div className="cs-badge">
            <Cpu size={16} color="#0B111C" />
          </div>
          <div>
            <div className="cs-kicker">
              {"ITE131 · Unit II · CPU Architecture"}
            </div>
            <h1 className="cs-title">CPU Simulator</h1>
          </div>
        </div>
        <div className="cs-phase-pill">
          <span
            className={`cs-phase-dot ${halted ? "is-halted" : phase !== "idle" ? "is-live" : ""}`}
          />
          <span className="cs-mono">{meta.label}</span>
        </div>
      </header>

      <div className="cs-spotlight">{spotlight}</div>

      <div className="cs-shell">
        {/* ---------- LEFT COLUMN: Program ---------- */}
        <section className="cs-panel cs-col">
          <h2 className="cs-panel-title">Program</h2>

          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="cs-mono cs-textarea"
                aria-label="Program source"
              />
              <div className="cs-presets">
                {Object.keys(PRESETS).map((name) => (
                  <button
                    key={name}
                    className="cs-btn cs-chip-btn"
                    onClick={() => setDraft(PRESETS[name])}
                  >
                    {name}
                  </button>
                ))}
              </div>
              {error && <div className="cs-error">{error}</div>}
              <button
                className="cs-btn cs-btn-primary cs-btn-block"
                onClick={loadProgram}
              >
                Load program
              </button>
            </>
          ) : (
            <>
              <div className="cs-listing">
                {program.map((instr, idx) => (
                  <div
                    key={idx}
                    className={`cs-mono cs-instr ${idx === displayLine ? "is-current" : ""}`}
                  >
                    <span className="cs-instr-num">{idx + 1}</span>
                    <span className="cs-instr-text">{instr.raw}</span>
                  </div>
                ))}
              </div>
              <button
                className="cs-btn cs-btn-ghost cs-btn-block"
                onClick={() => {
                  setEditing(true);
                  setRunning(false);
                }}
              >
                <PenLine size={14} />
                Edit program
              </button>
            </>
          )}

          <div className="cs-cycle">
            {CYCLE_STEPS.map((s, i) => {
              const cur = CYCLE_STEPS.indexOf(
                phase as (typeof CYCLE_STEPS)[number],
              );
              return (
                <div
                  key={s}
                  className={`cs-cycle-step ${i === cur ? "is-active" : ""} ${cur > i ? "is-done" : ""}`}
                >
                  <span className="cs-cycle-dot" />
                  <span className="cs-mono">{s}</span>
                </div>
              );
            })}
          </div>

          <div className="cs-controls">
            <button
              className="cs-btn cs-btn-primary"
              onClick={doStep}
              disabled={editing || halted}
            >
              <StepForward size={16} />
              Step
            </button>
            <button
              className="cs-btn cs-btn-ghost"
              onClick={() => setRunning((r) => !r)}
              disabled={editing || halted}
            >
              {running ? <Pause size={16} /> : <Play size={16} />}
              {running ? "Pause" : "Run"}
            </button>
            <button
              className="cs-btn cs-btn-ghost"
              onClick={() => resetState("Simulation reset.")}
              disabled={editing}
            >
              <RotateCcw size={16} />
              Reset
            </button>
          </div>
        </section>

        {/* ---------- MIDDLE COLUMN: CPU over Data Memory ---------- */}
        <div className="cs-col cs-mid">
          <section className="cs-panel cs-cpu">
            <h2 className="cs-panel-title">CPU</h2>

            <div className="cs-cpu-inner">
              <div>
                <div className="cs-special">
                  <Chip
                    label="PC"
                    value={pc + 1}
                    active={active.pc}
                    hint="Program Counter"
                  />
                  <Chip
                    label="IR"
                    value={ir ? ir.op : "—"}
                    active={active.ir}
                    hint="Instruction Register"
                  />
                  <Chip
                    label="ZF"
                    value={zeroFlag ? "1" : "0"}
                    active={active.zf}
                    hint="Zero Flag"
                  />
                </div>
              </div>

              <div className="cs-core">
                <div
                  className={`cs-block cs-cu ${active.cu ? "is-active cs-glow" : ""}`}
                >
                  <span className="cs-block-name">Control Unit</span>
                </div>

                <Wire v active={active.cu} color={AMBER} len={20} />

                <div className="cs-datapath">
                  <div
                    className={`cs-block cs-alu ${active.alu ? "is-active cs-glow" : ""}`}
                  >
                    <span className="cs-block-name">ALU</span>
                  </div>

                  <Wire active={active.alu} color={TEAL} len={20} />

                  <div className="cs-block cs-regs">
                    <div className="cs-reg-grid">
                      {REG_NAMES.map((r) => (
                        <RegChip
                          key={r}
                          name={r}
                          value={registers[r]}
                          reading={active.regsRead.includes(r)}
                          writing={active.regsWrite.includes(r)}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section
            className={`cs-panel cs-mem ${memActive ? (active.memWrite.length ? "is-writing" : "is-reading") : ""}`}
          >
            <h2 className="cs-panel-title">
              Data Memory
              <span className="cs-panel-note">16 cells</span>
            </h2>
            <div className="cs-mem-grid">
              {memory.map((v, addr) => {
                const reading = active.memRead.includes(addr);
                const writing = active.memWrite.includes(addr);
                return (
                  <div
                    key={addr}
                    title={`Address ${addr}`}
                    className={[
                      "cs-mono cs-mem-cell",
                      v !== 0 ? "is-used" : "",
                      reading ? "is-reading cs-glow" : "",
                      writing ? "is-writing cs-glow" : "",
                    ].join(" ")}
                  >
                    <span className="cs-mem-addr">{addr}</span>
                    <span className="cs-mem-val">{v}</span>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* ---------- RIGHT COLUMN: Execution trace ---------- */}
        <section className="cs-panel cs-col">
          <h2 className="cs-panel-title">Execution trace</h2>
          <div className="cs-log">
            {log.map((entry, i) => (
              <div key={i} className="cs-mono cs-log-row">
                <span className="cs-log-step">{entry.step}</span>
                <span
                  className={`cs-log-comp comp-${entry.component.replace(/\s+/g, "-").toLowerCase()}`}
                >
                  {entry.component}
                </span>
                <span className="cs-log-detail">{entry.detail}</span>
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </section>
      </div>
    </div>
  );
}

function Wire({
  v = false,
  active,
  color,
  len,
}: {
  v?: boolean;
  active: boolean;
  color: string;
  len: number;
}) {
  const dash = active ? color : "#233043";
  return (
    <div
      className={`cs-wire ${v ? "is-v" : "is-h"} ${active ? "is-live" : ""}`}
      style={{
        width: v ? 2 : len,
        height: v ? len : 2,
        backgroundImage: `repeating-linear-gradient(${v ? "180deg" : "90deg"}, ${dash} 0 5px, transparent 5px 10px)`,
        backgroundSize: v ? "100% 10px" : "10px 100%",
      }}
    />
  );
}

function Chip({
  label,
  value,
  active,
  hint,
}: {
  label: string;
  value: string | number;
  active: boolean;
  hint: string;
}) {
  return (
    <div
      className={`cs-special-chip ${active ? "is-active cs-glow" : ""}`}
      title={hint}
    >
      <span className="cs-mono cs-special-label">{label}</span>
      <span className="cs-mono cs-special-val">{value}</span>
    </div>
  );
}

function RegChip({
  name,
  value,
  reading,
  writing,
}: {
  name: string;
  value: number;
  reading: boolean;
  writing: boolean;
}) {
  return (
    <div
      className={[
        "cs-mono cs-reg",
        reading ? "is-reading cs-glow" : "",
        writing ? "is-writing cs-glow" : "",
      ].join(" ")}
    >
      <span className="cs-reg-name">{name}</span>
      <span className="cs-reg-val">{value}</span>
    </div>
  );
}

const AMBER = "#E3A857";
const TEAL = "#5FBDB0";
