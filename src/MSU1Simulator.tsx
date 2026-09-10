import { useState, useEffect, useRef } from "react";
import {
  Play,
  Pause,
  StepForward,
  ChevronsRight,
  RotateCcw,
  PenLine,
  Cpu,
} from "lucide-react";
import "./msu1.css";

/* ============================================================================
   MSU-1 / MSU-1M — the teaching machine from the ITE131 learning materials.

     word size        8 bits
     memory           16 locations, addresses 0-15, 8 bits each (von Neumann:
                      instructions and data share one memory)
     instruction      4-bit opcode + 4-bit operand, in one 8-bit word
     visible regs     ACC (8), X index (4), flags Z C N V
     internal regs    PC (4), MAR (4), MDR (8), IR (8), B (8)

   The simulator steps one CLOCK CYCLE at a time, not one instruction, because
   the micro-operation table (U3-S8) is the thing the unit is actually about.
   ========================================================================== */

const MEM = 16;

type Mnem =
  | "LDA" | "STA" | "ADD" | "SUB" | "LDI" | "JMP" | "JZ" | "AND"
  | "LDN" | "LDX" | "INX" | "NOT" | "SHL" | "OUT" | "HLT";

type OperandKind = "addr" | "imm" | "none";

type IsaEntry = {
  opcode: number;
  operand: OperandKind;
  mode: string;
  flags: string;
  rtl: string;
  desc: string;
};

/* Opcode 1110 is deliberately absent: it is the free slot the Unit III case
   study asks students to fill with an instruction of their own. */
const ISA: Record<Mnem, IsaEntry> = {
  LDA: { opcode: 0x0, operand: "addr", mode: "Direct",    flags: "Z N",     rtl: "ACC ← M[a]",         desc: "Load the accumulator from memory" },
  STA: { opcode: 0x1, operand: "addr", mode: "Direct",    flags: "—",       rtl: "M[a] ← ACC",         desc: "Store the accumulator into memory" },
  ADD: { opcode: 0x2, operand: "addr", mode: "Direct",    flags: "Z C N V", rtl: "ACC ← ACC + M[a]",   desc: "Add memory to the accumulator" },
  SUB: { opcode: 0x3, operand: "addr", mode: "Direct",    flags: "Z C N V", rtl: "ACC ← ACC − M[a]",   desc: "Subtract memory from the accumulator" },
  LDI: { opcode: 0x4, operand: "imm",  mode: "Immediate", flags: "Z N",     rtl: "ACC ← n",            desc: "Load an immediate constant (0–15)" },
  JMP: { opcode: 0x5, operand: "addr", mode: "Direct",    flags: "—",       rtl: "PC ← a",             desc: "Jump unconditionally" },
  JZ:  { opcode: 0x6, operand: "addr", mode: "Direct",    flags: "—",       rtl: "if Z=1 then PC ← a", desc: "Jump if the zero flag is set" },
  AND: { opcode: 0x7, operand: "addr", mode: "Direct",    flags: "Z N",     rtl: "ACC ← ACC ∧ M[a]",   desc: "Bitwise AND with memory" },
  LDN: { opcode: 0x8, operand: "addr", mode: "Indirect",  flags: "Z N",     rtl: "ACC ← M[M[a]]",      desc: "Load indirectly, through a pointer" },
  LDX: { opcode: 0x9, operand: "addr", mode: "Indexed",   flags: "Z N",     rtl: "ACC ← M[a + X]",     desc: "Load indexed by X" },
  INX: { opcode: 0xa, operand: "none", mode: "Implied",   flags: "Z",       rtl: "X ← X + 1",          desc: "Increment the index register" },
  NOT: { opcode: 0xb, operand: "none", mode: "Implied",   flags: "Z N",     rtl: "ACC ← ¬ACC",         desc: "Bitwise complement of the accumulator" },
  SHL: { opcode: 0xc, operand: "none", mode: "Implied",   flags: "Z C N",   rtl: "ACC ← ACC ≪ 1",      desc: "Shift the accumulator left one bit" },
  OUT: { opcode: 0xd, operand: "none", mode: "Implied",   flags: "—",       rtl: "display ← ACC",      desc: "Send the accumulator to the display" },
  HLT: { opcode: 0xf, operand: "none", mode: "Implied",   flags: "—",       rtl: "stop execution",     desc: "Halt" },
};

const MNEMS = Object.keys(ISA) as Mnem[];

const BY_OPCODE: (Mnem | null)[] = (() => {
  const t: (Mnem | null)[] = Array(16).fill(null);
  MNEMS.forEach((m) => (t[ISA[m].opcode] = m));
  return t;
})();

function isMnem(s: string): s is Mnem {
  return Object.hasOwn(ISA, s);
}

/* ---------------------------------------------------------------- formatting */

const hex2 = (v: number) => v.toString(16).toUpperCase().padStart(2, "0");
const hex1 = (v: number) => (v & 0xf).toString(16).toUpperCase();
const bin8 = (v: number) => v.toString(2).padStart(8, "0");
const bin4 = (v: number) => (v & 0xf).toString(2).padStart(4, "0");
const nib = (v: number) => `${bin4(v >> 4)} ${bin4(v)}`;
const signed8 = (v: number) => (v & 0x80 ? v - 256 : v);

/* Values are shown in hex first, because that is how the reference card and
   the hand-assembly exercises write them. */
function val(v: number) {
  const s = signed8(v);
  return s === v ? `${hex2(v)}h (${v})` : `${hex2(v)}h (${v} unsigned, ${s} signed)`;
}

function disasm(byte: number): { mn: Mnem | null; operand: number; text: string } {
  const op = (byte >> 4) & 0xf;
  const operand = byte & 0xf;
  const mn = BY_OPCODE[op];
  if (!mn) return { mn: null, operand, text: "—" };
  return {
    mn,
    operand,
    text: ISA[mn].operand === "none" ? mn : `${mn} ${operand}`,
  };
}

/* ----------------------------------------------------------------- assembler */

type Role = "code" | "data" | "empty";

type ListingRow = { addr: number; byte: number; text: string; kind: Role };

type Assembled = {
  image: number[];
  roles: Role[];
  listing: ListingRow[];
};

function parseNumber(tok: string, line: number): number {
  const t = tok.trim();
  let m: RegExpExecArray | null;
  if ((m = /^0x([0-9a-f]+)$/i.exec(t))) return parseInt(m[1], 16);
  if ((m = /^\$([0-9a-f]+)$/i.exec(t))) return parseInt(m[1], 16);
  if ((m = /^([0-9a-f]+)h$/i.exec(t))) return parseInt(m[1], 16);
  if ((m = /^0b([01]+)$/i.exec(t))) return parseInt(m[1], 2);
  if ((m = /^([01]{4,8})b$/i.exec(t))) return parseInt(m[1], 2);
  if (/^-?\d+$/.test(t)) return parseInt(t, 10);
  throw new Error(`Line ${line}: "${tok}" is not a number I can read`);
}

function assemble(text: string): Assembled {
  const image: number[] = Array(MEM).fill(0);
  const roles: Role[] = Array(MEM).fill("empty");
  const written: boolean[] = Array(MEM).fill(false);
  const listing: ListingRow[] = [];
  let lc = 0;

  const emit = (byte: number, kind: Role, label: string, ln: number) => {
    if (lc < 0 || lc >= MEM) {
      throw new Error(
        `Line ${ln}: address ${lc} is outside MSU-1 memory — there are only 16 locations (0–15)`,
      );
    }
    if (written[lc]) {
      throw new Error(
        `Line ${ln}: address ${lc} already holds a value placed by an earlier line`,
      );
    }
    written[lc] = true;
    image[lc] = byte;
    roles[lc] = kind;
    listing.push({ addr: lc, byte, text: label, kind });
    lc += 1;
  };

  text.split("\n").forEach((raw, i) => {
    const ln = i + 1;
    let s = raw.replace(/(#|;|\/\/).*$/, "").trim();
    if (!s) return;

    /* An "13:" prefix moves the location counter, so the listings in the
       learning material can be typed in verbatim. */
    const pfx = /^([^\s:]+)\s*:\s*(.*)$/.exec(s);
    if (pfx) {
      const a = parseNumber(pfx[1], ln);
      if (a < 0 || a >= MEM) {
        throw new Error(`Line ${ln}: address ${a} is outside MSU-1 memory (0–15)`);
      }
      lc = a;
      s = pfx[2].trim();
      if (!s) return;
    }

    const parts = s.split(/[\s,]+/).filter(Boolean);
    const head = parts[0].toUpperCase();

    if (head === "ORG") {
      if (parts.length !== 2) throw new Error(`Line ${ln}: ORG expects one address`);
      const a = parseNumber(parts[1], ln);
      if (a < 0 || a >= MEM) {
        throw new Error(`Line ${ln}: ORG ${a} is outside MSU-1 memory (0–15)`);
      }
      lc = a;
      return;
    }

    const asData = (tok: string) => {
      let v = parseNumber(tok, ln);
      if (v < -128 || v > 255) {
        throw new Error(
          `Line ${ln}: ${v} does not fit in one 8-bit MSU-1 word (−128 to 255)`,
        );
      }
      if (v < 0) v = (v + 256) & 0xff;
      emit(v, "data", String(v), ln);
    };

    if (head === "DAT" || head === "DB") {
      if (parts.length < 2) throw new Error(`Line ${ln}: ${head} expects a value`);
      parts.slice(1).forEach(asData);
      return;
    }

    if (isMnem(head)) {
      const info = ISA[head];
      const rest = parts.slice(1);
      if (info.operand === "none") {
        if (rest.length) {
          throw new Error(`Line ${ln}: ${head} is an implied-mode instruction and takes no operand`);
        }
        emit(info.opcode << 4, "code", head, ln);
        return;
      }
      if (rest.length !== 1) {
        throw new Error(
          `Line ${ln}: ${head} expects exactly one operand, got ${rest.length}`,
        );
      }
      const v = parseNumber(rest[0], ln);
      if (v < 0 || v > 15) {
        throw new Error(
          info.operand === "imm"
            ? `Line ${ln}: LDI can only load 0–15 — the operand field is 4 bits wide`
            : `Line ${ln}: address ${v} is outside MSU-1 memory (0–15) — the operand field is 4 bits wide`,
        );
      }
      emit((info.opcode << 4) | v, "code", `${head} ${v}`, ln);
      return;
    }

    /* A line that is nothing but a number is a data byte. */
    if (parts.length === 1) {
      asData(parts[0]);
      return;
    }

    throw new Error(`Line ${ln}: "${parts[0]}" is not an MSU-1 instruction`);
  });

  if (listing.length === 0) throw new Error("The program is empty.");
  return { image, roles, listing };
}

/* ------------------------------------------------------------- machine state */

type Flags = { Z: boolean; C: boolean; N: boolean; V: boolean };

type Machine = {
  mem: number[];
  pc: number;   // 4 bits
  mar: number;  // 4 bits
  mdr: number;  // 8 bits
  ir: number;   // 8 bits
  acc: number;  // 8 bits
  x: number;    // 4 bits
  b: number;    // 8 bits — the ALU's second-operand latch
  flags: Flags;
  out: number[];
  halted: boolean;
  cycles: number;
  retired: number; // instructions completed
  curAddr: number; // where the instruction now in IR was fetched from
};

function newMachine(image: number[]): Machine {
  return {
    mem: [...image],
    pc: 0, mar: 0, mdr: 0, ir: 0, acc: 0, x: 0, b: 0,
    flags: { Z: false, C: false, N: false, V: false },
    out: [],
    halted: false,
    cycles: 0,
    retired: 0,
    curAddr: -1,
  };
}

function cloneMachine(m: Machine): Machine {
  return { ...m, mem: [...m.mem], flags: { ...m.flags }, out: [...m.out] };
}

const flagLine = (m: Machine) =>
  `Flags: Z=${+m.flags.Z} C=${+m.flags.C} N=${+m.flags.N} V=${+m.flags.V}.`;

function setZN(m: Machine, r: number) {
  m.flags.Z = r === 0;
  m.flags.N = (r & 0x80) !== 0;
}

/* One 8-bit adder serves both ADD and SUB, which is the whole argument for
   two's complement (U3-S15). C is the carry out — unsigned overflow. V is set
   when the carry into the MSB differs from the carry out of it — signed
   overflow. The hardware cannot know which reading you meant, so it computes
   both (U3-S16). */
function addWithFlags(m: Machine, a: number, b: number, carryIn: number) {
  const sum = a + b + carryIn;
  const res = sum & 0xff;
  const carryOut = sum > 0xff;
  const carryInto7 = (a & 0x7f) + (b & 0x7f) + carryIn > 0x7f;
  m.flags.C = carryOut;
  m.flags.V = carryInto7 !== carryOut;
  m.flags.Z = res === 0;
  m.flags.N = (res & 0x80) !== 0;
  return res;
}

/* ------------------------------------------------------- micro-operations */

type Phase = "fetch" | "decode" | "execute";

type Hi = {
  cu?: boolean;
  alu?: boolean;
  pc?: boolean;
  mar?: boolean;
  mdr?: boolean;
  ir?: boolean;
  acc?: boolean;
  x?: boolean;
  b?: boolean;
  flags?: boolean;
  display?: boolean;
  memRead?: number;
  memWrite?: number;
  bus?: "addr" | "data";
};

type Micro = {
  t: number;
  phase: Phase;
  rtl: string;
  signals: string[];
  /* Evaluated against the machine *after* the transfer, so highlights can
     point at whatever address MAR ended up holding. */
  hi: (m: Machine) => Hi;
  run: (m: Machine) => string;
};

/* Every instruction begins with the same three cycles. */
function fetchSeq(): Micro[] {
  return [
    {
      t: 1,
      phase: "fetch",
      rtl: "MAR ← PC",
      signals: ["MAR_load"],
      hi: () => ({ cu: true, pc: true, mar: true, bus: "addr" }),
      run: (m) => {
        m.curAddr = m.pc;
        m.mar = m.pc;
        return `The address of the next instruction, ${m.pc} (${hex1(m.pc)}h), is copied out of PC into MAR and driven onto the 4-line address bus.`;
      },
    },
    {
      t: 2,
      phase: "fetch",
      rtl: "MDR ← M[MAR]; PC ← PC + 1",
      signals: ["MEM_read", "MDR_load", "PC_increment"],
      hi: (m) => ({ cu: true, mar: true, mdr: true, pc: true, memRead: m.mar, bus: "data" }),
      run: (m) => {
        m.mdr = m.mem[m.mar];
        m.pc = (m.pc + 1) & 0xf;
        return `Memory drives the 8-line data bus: MDR ← M[${m.mar}] = ${val(m.mdr)}. PC advances to ${m.pc} — during fetch, before the instruction has even been decoded.`;
      },
    },
    {
      t: 3,
      phase: "decode",
      rtl: "IR ← MDR",
      signals: ["IR_load"],
      hi: () => ({ cu: true, ir: true, mdr: true }),
      run: (m) => {
        m.ir = m.mdr;
        const d = disasm(m.ir);
        const opBits = bin4(m.ir >> 4);
        if (!d.mn) {
          return `IR ← MDR = ${hex2(m.ir)}h = ${nib(m.ir)}. Opcode ${opBits} is not defined on MSU-1.`;
        }
        const tail =
          ISA[d.mn].operand === "none"
            ? `no operand is used — ${d.mn} is implied mode`
            : `operand ${bin4(d.operand)} = ${d.operand}`;
        return `IR ← MDR = ${hex2(m.ir)}h = ${nib(m.ir)}. Opcode ${opBits} = ${d.mn}, ${tail}. The control unit now knows what to do.`;
      },
    },
  ];
}

/* Shared opening of every direct-mode execute phase. */
const marFromOperand = (a: number, note: string): Micro => ({
  t: 4,
  phase: "execute",
  rtl: "MAR ← IR[operand]",
  signals: ["MAR_load"],
  hi: () => ({ cu: true, ir: true, mar: true, bus: "addr" }),
  run: (m) => {
    m.mar = a;
    return `${note} MAR ← ${a}.`;
  },
});

const readIntoMdr = (t: number): Micro => ({
  t,
  phase: "execute",
  rtl: "MDR ← M[MAR]",
  signals: ["MEM_read", "MDR_load"],
  hi: (m) => ({ mar: true, mdr: true, memRead: m.mar, bus: "data" }),
  run: (m) => {
    m.mdr = m.mem[m.mar];
    return `MDR ← M[${m.mar}] = ${val(m.mdr)}.`;
  },
});

const accFromMdr = (t: number): Micro => ({
  t,
  phase: "execute",
  rtl: "ACC ← MDR",
  signals: ["ACC_load"],
  hi: () => ({ acc: true, mdr: true, flags: true }),
  run: (m) => {
    m.acc = m.mdr;
    setZN(m, m.acc);
    return `ACC ← ${val(m.acc)}. ${flagLine(m)}`;
  },
});

/* An ALU step: MDR is latched into the B input in the same cycle, which is
   what the B register in the MSU-1 spec is for. */
function aluStep(
  t: number,
  rtl: string,
  op: string,
  apply: (m: Machine, before: number) => string,
): Micro {
  return {
    t,
    phase: "execute",
    rtl,
    signals: [`ALU_op = ${op}`, "ACC_load"],
    hi: () => ({ alu: true, acc: true, mdr: true, b: true, flags: true }),
    run: (m) => {
      m.b = m.mdr;
      const before = m.acc;
      return apply(m, before);
    },
  };
}

function execSeq(mn: Mnem | null, a: number): Micro[] {
  switch (mn) {
    case "LDA":
      return [
        marFromOperand(a, `Direct addressing: the effective address is the operand field itself, ${a}.`),
        readIntoMdr(5),
        accFromMdr(6),
      ];

    case "STA":
      return [
        marFromOperand(a, `Direct addressing: the destination is location ${a}.`),
        {
          t: 5,
          phase: "execute",
          rtl: "MDR ← ACC",
          signals: ["MDR_load"],
          hi: () => ({ acc: true, mdr: true }),
          run: (m) => {
            m.mdr = m.acc;
            return `The value to be written crosses the internal bus into MDR: ${val(m.mdr)}.`;
          },
        },
        {
          t: 6,
          phase: "execute",
          rtl: "M[MAR] ← MDR",
          signals: ["MEM_write"],
          hi: (m) => ({ mar: true, mdr: true, memWrite: m.mar, bus: "data" }),
          run: (m) => {
            m.mem[m.mar] = m.mdr;
            return `M[${m.mar}] ← ${val(m.mdr)}. STA affects no flags — the accumulator is unchanged.`;
          },
        },
      ];

    case "ADD":
      return [
        marFromOperand(a, `Direct addressing: the addend lives at location ${a}.`),
        readIntoMdr(5),
        aluStep(6, "ACC ← ACC + MDR", "ADD", (m, before) => {
          m.acc = addWithFlags(m, before, m.b, 0);
          return `MDR is latched into the ALU's B input; the ALU adds ${val(before)} + ${val(m.b)} = ${val(m.acc)}. ${flagLine(m)}`;
        }),
      ];

    case "SUB":
      return [
        marFromOperand(a, `Direct addressing: the subtrahend lives at location ${a}.`),
        readIntoMdr(5),
        aluStep(6, "ACC ← ACC − MDR", "SUB", (m, before) => {
          const comp = (~m.b) & 0xff;
          m.acc = addWithFlags(m, before, comp, 1);
          return `Subtraction is addition of the two's complement: ${hex2(before)}h + ${hex2(comp)}h + 1 = ${val(m.acc)}. The same adder does both. C=${+m.flags.C} here means no borrow occurred. ${flagLine(m)}`;
        }),
      ];

    case "AND":
      return [
        marFromOperand(a, `Direct addressing: the mask lives at location ${a}.`),
        readIntoMdr(5),
        aluStep(6, "ACC ← ACC ∧ MDR", "AND", (m, before) => {
          m.acc = before & m.b;
          setZN(m, m.acc);
          return `${bin8(before)} ∧ ${bin8(m.b)} = ${bin8(m.acc)} (${val(m.acc)}). ${flagLine(m)}`;
        }),
      ];

    case "LDI":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "ACC ← IR[operand]",
          signals: ["ACC_load"],
          hi: () => ({ cu: true, ir: true, acc: true, flags: true }),
          run: (m) => {
            m.acc = a;
            setZN(m, m.acc);
            return `Immediate addressing: the operand field is the value, so there is no second memory access at all — T4 to T6 collapse into this one cycle. ACC ← ${a}. Compare LDA ${a}, which would have gone and fetched M[${a}]. ${flagLine(m)}`;
          },
        },
      ];

    case "JMP":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "PC ← IR[operand]",
          signals: ["PC_load"],
          hi: () => ({ cu: true, ir: true, pc: true }),
          run: (m) => {
            m.pc = a;
            return `Unconditional jump: PC ← ${a}. The jump works by overwriting a PC that fetch had already advanced.`;
          },
        },
      ];

    case "JZ":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "if Z=1 then PC ← IR[operand]",
          signals: ["PC_load (conditional)"],
          hi: () => ({ cu: true, ir: true, pc: true, flags: true }),
          run: (m) => {
            if (m.flags.Z) {
              m.pc = a;
              return `Z=1, so the branch is taken: PC ← ${a}. The machine has no notion of "if" — only a flag and an instruction that consults it.`;
            }
            return `Z=0, so the branch is not taken and execution falls through to ${m.pc}.`;
          },
        },
      ];

    case "LDN":
      return [
        marFromOperand(a, `Indirect addressing, step one: location ${a} holds a pointer, not the data.`),
        readIntoMdr(5),
        {
          t: 6,
          phase: "execute",
          rtl: "MAR ← MDR",
          signals: ["MAR_load"],
          hi: () => ({ mar: true, mdr: true, bus: "addr" }),
          run: (m) => {
            const full = m.mdr;
            m.mar = full & 0xf;
            const note =
              full > 15
                ? ` MAR is only 4 bits wide, so the low nibble of ${hex2(full)}h is used.`
                : "";
            return `The pointer just read becomes the new address: MAR ← ${m.mar}.${note} This second memory access is the cost of one level of indirection.`;
          },
        },
        readIntoMdr(7),
        accFromMdr(8),
      ];

    case "LDX":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "MAR ← IR[operand] + X",
          signals: ["ALU_op = ADD", "MAR_load"],
          hi: () => ({ cu: true, ir: true, x: true, mar: true, alu: true, bus: "addr" }),
          run: (m) => {
            const sum = a + m.x;
            m.mar = sum & 0xf;
            const note = sum > 15 ? ` The 4-bit address wraps: ${sum} → ${m.mar}.` : "";
            return `Indexed addressing: EA = base ${a} + X (${m.x}) = ${m.mar}.${note} A for-loop over an array becomes exactly this, plus an INX.`;
          },
        },
        readIntoMdr(5),
        accFromMdr(6),
      ];

    case "INX":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "X ← X + 1",
          signals: ["X_increment"],
          hi: () => ({ cu: true, x: true, flags: true }),
          run: (m) => {
            m.x = (m.x + 1) & 0xf;
            m.flags.Z = m.x === 0;
            return `X ← ${m.x}. X is only 4 bits wide, so it wraps from 15 back to 0. Z=${+m.flags.Z}.`;
          },
        },
      ];

    case "NOT":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "ACC ← ¬ACC",
          signals: ["ALU_op = NOT", "ACC_load"],
          hi: () => ({ alu: true, acc: true, flags: true }),
          run: (m) => {
            const before = m.acc;
            m.acc = ~before & 0xff;
            setZN(m, m.acc);
            return `${bin8(before)} inverted is ${bin8(m.acc)} (${val(m.acc)}). Add one to this and you have the two's complement negation. ${flagLine(m)}`;
          },
        },
      ];

    case "SHL":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "ACC ← ACC ≪ 1",
          signals: ["ALU_op = SHL", "ACC_load"],
          hi: () => ({ alu: true, acc: true, flags: true }),
          run: (m) => {
            const before = m.acc;
            m.flags.C = (before & 0x80) !== 0;
            m.acc = (before << 1) & 0xff;
            setZN(m, m.acc);
            return `${bin8(before)} ≪ 1 = ${bin8(m.acc)} (${val(m.acc)}). The bit shifted out of the MSB lands in C=${+m.flags.C}. A left shift doubles the value — when it still fits. ${flagLine(m)}`;
          },
        },
      ];

    case "OUT":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "display ← ACC",
          signals: ["OUT_enable"],
          hi: () => ({ cu: true, acc: true, display: true }),
          run: (m) => {
            m.out = [...m.out, m.acc].slice(-32);
            return `The accumulator is sent to the output device: ${val(m.acc)}. This is the I/O component from the four-part system model.`;
          },
        },
      ];

    case "HLT":
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "stop execution",
          signals: ["HALT"],
          hi: () => ({ cu: true }),
          run: (m) => {
            m.halted = true;
            return `HLT — the control unit stops the clock. Nothing further is fetched.`;
          },
        },
      ];

    default:
      return [
        {
          t: 4,
          phase: "execute",
          rtl: "— (undefined opcode)",
          signals: ["HALT"],
          hi: () => ({ cu: true }),
          run: (m) => {
            m.halted = true;
            return `Opcode 1110 has no instruction defined on MSU-1 — it is the free slot the Unit III case study asks you to fill. With nothing to decode, the machine halts.`;
          },
        },
      ];
  }
}

/* ------------------------------------------------------------ the simulator */

type LogEntry = { n: number; t: number; phase: Phase | null; rtl: string; detail: string };

type Spot = { t: number | null; phase: Phase | null; rtl: string; detail: string };

type Sim = {
  m: Machine;
  seq: Micro[];
  idx: number; // micro-steps of seq already executed
  hi: Hi;
  log: LogEntry[];
  spot: Spot;
};

function initSim(image: number[], msg: string): Sim {
  return {
    m: newMachine(image),
    seq: fetchSeq(),
    idx: 0,
    hi: {},
    log: [{ n: 0, t: 0, phase: null, rtl: "", detail: msg }],
    spot: { t: null, phase: null, rtl: "MSU-1 ready", detail: msg },
  };
}

/* One clock cycle. The execute micro-steps cannot be known until T3 has put
   the opcode into IR, so the sequence is extended at exactly that point. */
function advance(s: Sim): Sim {
  if (s.m.halted) return s;

  let seq = s.seq;
  let idx = s.idx;
  if (idx >= seq.length) {
    seq = fetchSeq();
    idx = 0;
  }

  const step = seq[idx];
  const m = cloneMachine(s.m);
  const detail = step.run(m);
  m.cycles += 1;
  idx += 1;

  if (idx === 3 && seq.length === 3) {
    const d = disasm(m.ir);
    seq = [...seq, ...execSeq(d.mn, d.operand)];
  }
  if (idx >= seq.length) m.retired += 1;

  const n = s.log.length ? s.log[s.log.length - 1].n + 1 : 1;
  return {
    m,
    seq,
    idx,
    hi: step.hi(m),
    log: [...s.log, { n, t: step.t, phase: step.phase, rtl: step.rtl, detail }].slice(-300),
    spot: { t: step.t, phase: step.phase, rtl: step.rtl, detail },
  };
}

function advanceInstruction(s: Sim): Sim {
  let cur = advance(s);
  let guard = 0;
  while (!cur.m.halted && cur.idx < cur.seq.length && guard++ < 16) cur = advance(cur);
  return cur;
}

/* --------------------------------------------------------------- programs */

const PRESETS: { name: string; note: string; src: string }[] = [
  {
    name: "Add & display",
    note: "U3-S9",
    src: `# Compute 25 + 17 and display the result (U3-S9)
LDA 13        # ACC <- M[13] = 25
ADD 14        # ACC <- 25 + 17 = 42
STA 15        # M[15] <- 42
OUT           # display <- 42
HLT

13: 25        # data
14: 17        # data`,
  },
  {
    name: "Carry vs overflow",
    note: "U3-S16",
    src: `# 100 + 50 in 8 bits: right as unsigned, overflowed as signed.
# Watch C stay 0 while V goes to 1.
LDA 14
ADD 15
OUT
HLT

14: 100
15: 50`,
  },
  {
    name: "Indirect — LDN",
    note: "U3-S11",
    src: `# M[12] holds 7, and M[7] holds 99, so LDN 12 loads 99.
# Two memory accesses instead of one: that is what a pointer costs.
LDN 12
OUT
HLT

7:  99        # the data
12: 7         # the pointer`,
  },
  {
    name: "Indexed — LDX / INX",
    note: "U3-S12",
    src: `# Walk an array with the index register: EA = base + X.
LDI 0
STA 13        # M[13] = running total
LDX 14        # ACC <- M[14 + X], X = 0
ADD 13
STA 13
INX           # X <- 1
LDX 14        # ACC <- M[14 + X], X = 1
ADD 13
OUT           # 30 + 12 = 42
HLT

14: 30
15: 12`,
  },
  {
    name: "Countdown loop",
    note: "JZ / JMP",
    src: `# Count 3, 2, 1, 0 to the display.
# The machine has no "if" — only the Z flag and JZ.
LDI 3
STA 14        # counter
LDA 14        # <- loop top (address 2)
OUT
SUB 15        # counter - 1
STA 14
JZ 8          # Z set means the counter hit zero
JMP 2
OUT           # address 8: show the final 0
HLT

15: 1`,
  },
  {
    name: "Bitwise — AND / SHL / NOT",
    note: "U3-S17",
    src: `# Mask, shift and complement. Watch C on the shift.
LDA 13
AND 14        # keep the low nibble
OUT
SHL           # double it
OUT
NOT           # invert every bit
OUT
HLT

13: 0xB6
14: 0x0F`,
  },
];

const DEFAULT_SRC = PRESETS[0].src;

const SPEEDS: { name: string; ms: number }[] = [
  { name: "Slow", ms: 1100 },
  { name: "Normal", ms: 550 },
  { name: "Fast", ms: 170 },
];

const PHASES: Phase[] = ["fetch", "decode", "execute"];

/* The full set of control signals the MSU-1 control unit can assert. They are
   all drawn every cycle; the ones being asserted light up (U2-S9). */
const SIGNAL_LIST = [
  "MAR_load", "MEM_read", "MEM_write", "MDR_load",
  "IR_load", "PC_increment", "PC_load", "ACC_load",
  "X_increment", "ALU_op", "OUT_enable", "HALT",
];

export default function MSU1Simulator() {
  const [draft, setDraft] = useState(DEFAULT_SRC);
  const [editing, setEditing] = useState(true);
  const [asm, setAsm] = useState<Assembled | null>(null);
  const [error, setError] = useState("");
  const [sim, setSim] = useState<Sim>(() =>
    initSim(Array(MEM).fill(0), "Assemble a program to begin."),
  );
  const [running, setRunning] = useState(false);
  const [speed, setSpeed] = useState(1);

  const logEnd = useRef<HTMLDivElement>(null);
  useEffect(() => {
    logEnd.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [sim.log]);

  const { m, hi } = sim;
  const halted = m.halted;
  const ready = !editing && asm !== null;

  const lastStep = sim.idx > 0 ? sim.seq[sim.idx - 1] : null;
  const signals = lastStep ? lastStep.signals : [];
  const decoded = sim.seq.length > 3 ? disasm(m.ir) : null;
  const aluOp = signals.find((s) => s.startsWith("ALU_op"))?.split("= ")[1] ?? "—";
  const cpi = m.retired > 0 ? (m.cycles / m.retired).toFixed(2) : "—";
  const phaseLabel = halted
    ? "Halted"
    : sim.spot.t
      ? `T${sim.spot.t} · ${sim.spot.phase}`
      : "Ready";

  const roles = asm ? asm.roles : (Array(MEM).fill("empty") as Role[]);

  /* `advance` is a pure module-level function, so the functional update never
     goes stale; the effect simply re-arms itself after each cycle. Halting
     stops the clock through `isRunning` rather than through a setState in an
     effect. */
  const isRunning = running && !halted && ready;
  useEffect(() => {
    if (!isRunning) return;
    const t = setTimeout(() => setSim(advance), SPEEDS[speed].ms);
    return () => clearTimeout(t);
  }, [isRunning, speed, m.cycles]);

  function load() {
    try {
      const a = assemble(draft);
      setAsm(a);
      setSim(
        initSim(
          a.image,
          "Program assembled into memory. Press Cycle to advance one clock cycle at a time.",
        ),
      );
      setError("");
      setEditing(false);
      setRunning(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function reset() {
    if (!asm) return;
    setRunning(false);
    setSim(initSim(asm.image, "Machine reset — memory reloaded from the assembled program."));
  }

  return (
    <div className="m1-app">
      <header className="m1-header">
        <div className="m1-header-left">
          <div className="m1-badge">
            <Cpu size={16} color="#0B111C" />
          </div>
          <div>
            <div className="m1-kicker">ITE131 · Units I–V · the MSU-1 teaching machine</div>
            <h1 className="m1-title">MSU-1 Simulator</h1>
          </div>
        </div>
        <div className="m1-stats">
          <Stat label="cycles" value={m.cycles} />
          <Stat label="instructions" value={m.retired} />
          <Stat label="CPI" value={cpi} />
          <div className="m1-phase-pill">
            <span
              className={`m1-phase-dot ${halted ? "is-halted" : sim.spot.t ? "is-live" : ""}`}
            />
            <span className="m1-mono">{phaseLabel}</span>
          </div>
        </div>
      </header>

      <div className="m1-spotlight">
        <span className="m1-mono m1-spot-rtl">{sim.spot.rtl}</span>
        <span className="m1-spot-detail">{sim.spot.detail}</span>
      </div>

      <div className="m1-shell">
        {/* ------------------------------- program ------------------------- */}
        <section className="m1-panel m1-col">
          <h2 className="m1-panel-title">
            Program
            <span className="m1-panel-note">assembly → 8-bit words</span>
          </h2>

          {editing ? (
            <>
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                spellCheck={false}
                className="m1-mono m1-textarea"
                aria-label="MSU-1 assembly source"
              />
              <div className="m1-presets">
                {PRESETS.map((p) => (
                  <button
                    key={p.name}
                    className="m1-btn m1-chip-btn"
                    onClick={() => setDraft(p.src)}
                    title={`${p.name} — ${p.note}`}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
              {error && <div className="m1-error">{error}</div>}
              <button className="m1-btn m1-btn-primary m1-btn-block" onClick={load}>
                Assemble &amp; load
              </button>
            </>
          ) : (
            <>
              <div className="m1-listing">
                <div className="m1-mono m1-listing-head">
                  <span>addr</span>
                  <span>hex</span>
                  <span>source</span>
                </div>
                {asm?.listing.map((row) => (
                  <div
                    key={row.addr}
                    className={[
                      "m1-mono m1-lrow",
                      row.kind === "data" ? "is-data" : "",
                      row.addr === m.curAddr ? "is-current" : "",
                      row.addr === m.pc && !halted ? "is-next" : "",
                    ].join(" ")}
                  >
                    <span className="m1-laddr">{row.addr}</span>
                    <span className="m1-lhex">{hex2(row.byte)}</span>
                    <span className="m1-ltext">{row.text}</span>
                  </div>
                ))}
              </div>
              <div className="m1-reg-group-label m1-reflabel">Instruction set — reference card</div>
              <div className="m1-ref">
                <div className="m1-mono m1-refrow m1-refhead">
                  <span>op</span>
                  <span>mnemonic</span>
                  <span>operation</span>
                </div>
                {BY_OPCODE.map((mn, op) => (
                  <div
                    key={op}
                    className={`m1-mono m1-refrow ${mn && decoded?.mn === mn ? "is-active" : ""} ${mn ? "" : "is-reserved"}`}
                  >
                    <span className="m1-refop">{hex1(op)}</span>
                    <span className="m1-refmn">
                      {mn
                        ? ISA[mn].operand === "none"
                          ? mn
                          : `${mn} ${ISA[mn].operand === "imm" ? "n" : "a"}`
                        : "—"}
                    </span>
                    <span className="m1-refrtl">{mn ? ISA[mn].rtl : "reserved — yours to define"}</span>
                  </div>
                ))}
              </div>

              <button
                className="m1-btn m1-btn-ghost m1-btn-block"
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

          <div className="m1-cycle">
            {PHASES.map((p) => (
              <div
                key={p}
                className={`m1-cycle-step ${sim.spot.phase === p ? "is-active" : ""}`}
              >
                <span className="m1-cycle-dot" />
                <span className="m1-mono">{p}</span>
              </div>
            ))}
          </div>

          <div className="m1-controls">
            <button
              className="m1-btn m1-btn-primary"
              onClick={() => setSim(advance)}
              disabled={!ready || halted}
              title="Advance one clock cycle"
            >
              <StepForward size={15} />
              Cycle
            </button>
            <button
              className="m1-btn m1-btn-ghost"
              onClick={() => setSim(advanceInstruction)}
              disabled={!ready || halted}
              title="Run to the end of the current instruction"
            >
              <ChevronsRight size={15} />
              Instruction
            </button>
            <button
              className="m1-btn m1-btn-ghost"
              onClick={() => setRunning((r) => !r)}
              disabled={!ready || halted}
            >
              {isRunning ? <Pause size={15} /> : <Play size={15} />}
              {isRunning ? "Pause" : "Run"}
            </button>
            <button className="m1-btn m1-btn-ghost" onClick={reset} disabled={!ready}>
              <RotateCcw size={15} />
              Reset
            </button>
          </div>

          <div className="m1-speed">
            <span>clock</span>
            {SPEEDS.map((s, i) => (
              <button
                key={s.name}
                className={`m1-speed-btn ${i === speed ? "is-active" : ""}`}
                onClick={() => setSpeed(i)}
              >
                {s.name}
              </button>
            ))}
          </div>
        </section>

        {/* ---------------------------------- CPU -------------------------- */}
        <div className="m1-col m1-mid">
          <section className="m1-panel m1-cpu">
            <h2 className="m1-panel-title">
              CPU
              <span className="m1-panel-note">single accumulator · von Neumann</span>
            </h2>

            <div className="m1-reg-group-label">Programmer-visible — architecture</div>
            <div className="m1-regs m1-regs-visible">
              <Reg name="ACC" bits={8} value={m.acc} active={hi.acc} hint="Accumulator — the implied operand and destination of nearly every operation" />
              <Reg name="X" bits={4} value={m.x} active={hi.x} hint="Index register — added to the operand field in indexed addressing" />
              <div className={`m1-flags ${hi.flags ? "is-active m1-glow" : ""}`}>
                <span className="m1-flags-label">flags</span>
                <div className="m1-flag-row">
                  <FlagBit name="Z" on={m.flags.Z} hint="Zero — the result was exactly zero" />
                  <FlagBit name="C" on={m.flags.C} hint="Carry — unsigned overflow" />
                  <FlagBit name="N" on={m.flags.N} hint="Negative — the MSB of the result is 1" />
                  <FlagBit name="V" on={m.flags.V} hint="Overflow — signed overflow" />
                </div>
              </div>
            </div>

            <div className="m1-reg-group-label">Internal — organization</div>
            <div className="m1-regs m1-regs-internal">
              <Reg name="PC" bits={4} value={m.pc} active={hi.pc} hint="Program counter — address of the NEXT instruction" />
              <Reg name="MAR" bits={4} value={m.mar} active={hi.mar} hint="Memory address register — as wide as the address bus" />
              <Reg name="MDR" bits={8} value={m.mdr} active={hi.mdr} hint="Memory data register — as wide as the data bus" />
              <Reg
                name="IR"
                bits={8}
                value={m.ir}
                active={hi.ir}
                hint="Instruction register — the instruction CURRENTLY executing"
                sub={decoded ? decoded.text : undefined}
              />
              <Reg name="B" bits={8} value={m.b} active={hi.b} hint="ALU second-operand latch" />
            </div>

            <div className="m1-core">
              <div className={`m1-block m1-cu ${hi.cu ? "is-active m1-glow" : ""}`}>
                <span className="m1-block-name">Control Unit</span>
                <span className="m1-block-sub">decodes IR, consults the flags, issues signals</span>
              </div>
              <div className="m1-signals">
                {SIGNAL_LIST.map((s) => {
                  const hit = signals.find((a) => a.startsWith(s));
                  return (
                    <span key={s} className={`m1-mono m1-sig ${hit ? "is-on" : ""}`}>
                      {hit ?? s}
                    </span>
                  );
                })}
              </div>
              <div className={`m1-block m1-alu ${hi.alu ? "is-active m1-glow" : ""}`}>
                <span className="m1-block-name">ALU</span>
                <span className="m1-mono m1-alu-io">
                  A={hex2(m.acc)}h · B={hex2(m.b)}h · op={aluOp}
                </span>
              </div>
              <div className="m1-bus">
                <div className={`m1-buslane ${hi.bus === "addr" ? "is-on" : ""}`}>
                  <span className="m1-mono">address bus · 4 lines</span>
                  <span className="m1-mono m1-busval">{hi.bus === "addr" ? bin4(m.mar) : "————"}</span>
                </div>
                <div className={`m1-buslane ${hi.bus === "data" ? "is-on" : ""}`}>
                  <span className="m1-mono">data bus · 8 lines</span>
                  <span className="m1-mono m1-busval">{hi.bus === "data" ? bin8(m.mdr) : "————————"}</span>
                </div>
              </div>
            </div>
          </section>

          <section className="m1-panel m1-micro">
            <h2 className="m1-panel-title">
              Micro-operations
              <span className="m1-panel-note">
                {decoded ? `${decoded.text} · ${sim.seq.length} clock cycles` : "fetch phase"}
              </span>
            </h2>
            <div className="m1-microtable">
              <div className="m1-mono m1-mrow m1-mhead">
                <span>T</span>
                <span>phase</span>
                <span>register transfer</span>
              </div>
              {sim.seq.map((s, i) => (
                <div
                  key={i}
                  className={[
                    "m1-mono m1-mrow",
                    i < sim.idx - 1 ? "is-done" : "",
                    i === sim.idx - 1 ? "is-current" : "",
                    i === sim.idx ? "is-next" : "",
                  ].join(" ")}
                >
                  <span className="m1-mt">T{s.t}</span>
                  <span className="m1-mphase">{s.phase}</span>
                  <span className="m1-mrtl">{s.rtl}</span>
                </div>
              ))}
              {sim.seq.length === 3 && (
                <div className="m1-mono m1-mrow is-pending">
                  <span className="m1-mt">T4…</span>
                  <span className="m1-mphase">execute</span>
                  <span className="m1-mrtl">not known until the opcode reaches IR</span>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* -------------------------------- memory ------------------------- */}
        <div className="m1-col m1-right">
          <section className="m1-panel m1-mem">
            <h2 className="m1-panel-title">
              Memory
              <span className="m1-panel-note">16 words × 8 bits</span>
            </h2>
            <div className="m1-memtable">
              <div className="m1-mono m1-memrow m1-memhead">
                <span>addr</span>
                <span>hex</span>
                {/* tagged so the narrow layout hides the header cell with its column */}
                <span className="m1-mbin">binary</span>
                <span>as instruction</span>
                <span>as data</span>
              </div>
              {m.mem.map((byte, addr) => {
                const d = disasm(byte);
                const isCode = roles[addr] === "code";
                return (
                  <div
                    key={addr}
                    className={[
                      "m1-mono m1-memrow",
                      roles[addr] === "empty" && byte === 0 ? "is-empty" : "",
                      addr === m.pc && !halted ? "is-pc" : "",
                      addr === m.curAddr ? "is-cur" : "",
                      hi.memRead === addr ? "is-read m1-glow" : "",
                      hi.memWrite === addr ? "is-write m1-glow" : "",
                    ].join(" ")}
                  >
                    <span className="m1-maddr">
                      {addr}
                      <em>{hex1(addr)}</em>
                    </span>
                    <span className="m1-mhex">{hex2(byte)}</span>
                    <span className="m1-mbin">{nib(byte)}</span>
                    <span className={`m1-masm ${isCode ? "" : "is-dim"}`}>{d.text}</span>
                    <span className={`m1-mdec ${isCode ? "is-dim" : ""}`}>
                      {byte}
                      {signed8(byte) !== byte ? `/${signed8(byte)}` : ""}
                    </span>
                  </div>
                );
              })}
            </div>
            <p className="m1-memfoot">
              One memory holds both code and data — the same bits read either way.
            </p>
          </section>

          <section className={`m1-panel m1-out ${hi.display ? "is-active" : ""}`}>
            <h2 className="m1-panel-title">
              Output
              <span className="m1-panel-note">I/O · OUT</span>
            </h2>
            <div className="m1-outstrip">
              {m.out.length === 0 ? (
                <span className="m1-outempty">nothing displayed yet</span>
              ) : (
                m.out.map((v, i) => (
                  <span
                    key={i}
                    className={`m1-mono m1-outval ${i === m.out.length - 1 ? "is-last" : ""}`}
                    title={`${hex2(v)}h · ${bin8(v)}`}
                  >
                    {v}
                  </span>
                ))
              )}
            </div>
          </section>

          <section className="m1-panel m1-trace">
            <h2 className="m1-panel-title">
              Execution trace
              <span className="m1-panel-note">one row per clock cycle</span>
            </h2>
            <div className="m1-log">
              {sim.log.map((e, i) => (
                <div key={i} className="m1-logrow">
                  <div className="m1-mono m1-loghead">
                    {e.phase && <span className={`m1-logt phase-${e.phase}`}>T{e.t}</span>}
                    <span className="m1-logrtl">{e.rtl}</span>
                  </div>
                  <div className="m1-logdetail">{e.detail}</div>
                </div>
              ))}
              <div ref={logEnd} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------- fragments */

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="m1-stat">
      <span className="m1-mono m1-stat-val">{value}</span>
      <span className="m1-stat-label">{label}</span>
    </div>
  );
}

function Reg({
  name, bits, value, active, hint, sub,
}: {
  name: string;
  bits: 4 | 8;
  value: number;
  active?: boolean;
  hint: string;
  sub?: string;
}) {
  return (
    <div className={`m1-reg ${active ? "is-active m1-glow" : ""}`} title={hint}>
      <div className="m1-reg-top">
        <span className="m1-reg-name">{name}</span>
        <span className="m1-reg-bits">{bits}</span>
      </div>
      <div className="m1-mono m1-reg-hex">
        {bits === 4 ? hex1(value) : hex2(value)}
        <em>h</em>
      </div>
      <div className="m1-mono m1-reg-bin">{bits === 4 ? bin4(value) : nib(value)}</div>
      <div className="m1-mono m1-reg-sub">{sub ?? String(bits === 4 ? value & 0xf : value)}</div>
    </div>
  );
}

function FlagBit({ name, on, hint }: { name: string; on: boolean; hint: string }) {
  return (
    <div className={`m1-mono m1-flag ${on ? "is-on" : ""}`} title={hint}>
      <span className="m1-flag-name">{name}</span>
      <span className="m1-flag-val">{on ? 1 : 0}</span>
    </div>
  );
}
