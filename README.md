# CPU Simulator — Computer Architecture and Operating Systems

# Reuqirements

- Install node version 24 (https://nodejs.org/en/download)
- Install pnpm version 11 (https://pnpm.io/)
- Run `pnpm install`

Two CPU visualisers for ITE131 lectures, served from one app and switched with
the tabs at the top:

| Route               | Simulator           | What it is                                                                                                                                            |
| ------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `#/cpu` _(default)_ | **CPU Simulator**   | A generic four-register machine. Fetch / decode / execute at the phase level — the gentler introduction, and the one Unit II was built around.        |
| `#/msu1`            | **MSU-1 Simulator** | The MSU-1 teaching machine from the Units I–V materials: 8-bit words, 16 shared locations, single accumulator, stepped one **clock cycle** at a time. |

They share nothing but the page shell, so each can be taught, changed or shown
on its own. Routing is by URL hash, so both deep links survive a refresh from
any static host and even from `file://`.

```bash
pnpm install
pnpm dev        # http://localhost:5173  -> #/cpu
                # http://localhost:5173/#/msu1
```

Other scripts: `pnpm build` (typecheck + production bundle), `pnpm preview`,
`pnpm lint`.

---

# 1 · CPU Simulator — `#/cpu`

An interactive fetch–decode–execute visualiser for lectures on CPU
organisation. Students type a short assembly program, then step through it one
phase at a time and watch the Control Unit, ALU, registers and data memory
light up as each instruction moves through the machine.

## What it shows

| Region              | What it represents                                     |
| ------------------- | ------------------------------------------------------ |
| **PC / IR / ZF**    | Program Counter, Instruction Register, Zero Flag       |
| **Control Unit**    | Fetches and decodes; drives jumps and `HALT`           |
| **ALU**             | Arithmetic and comparison                              |
| **Registers**       | Four general-purpose registers, `R0`–`R3`              |
| **Data Memory**     | 16 cells, addresses `0`–`15`                           |
| **Execution trace** | Running commentary, one line per phase (last 200 kept) |

Highlight colours carry meaning: **amber** marks control-unit activity and
writes, **teal** marks the ALU and reads. The spotlight bar under the header
narrates the phase that just executed. Animations respect
`prefers-reduced-motion`.

## Using the simulator

1. Type a program in the **Program** panel, or pick a preset chip
   (_Multiply & store_, _Add & compare_).
2. Press **Load program**. Operands are validated here — errors are reported
   with a source line number and nothing runs until they are fixed.
3. **Step** advances the machine by one _phase_. **Run** does the same
   automatically every 750 ms; **Pause** stops it. **Reset** clears registers,
   memory and flags but keeps the program loaded. **Edit program** returns to
   the editor.

Each instruction takes four Step presses, which is the point of the tool — the
fetch/decode/execute stepper on the left shows where you are:

```
fetch  →  decode  →  execute  →  (idle, ready for the next fetch)
```

Note that `PC` is displayed as a 1-based instruction number so it lines up with
the numbered program listing, and it is incremented during **fetch** — so
during decode and execute it already points at the _next_ instruction, exactly
as in real hardware.

## Instruction set

Mnemonics are case-insensitive and operands are comma-separated. Comments start
with `#` or `//` and may follow an instruction on the same line. Blank and
comment-only lines are ignored.

| Instruction      | Operands          | Effect                       |
| ---------------- | ----------------- | ---------------------------- |
| `LOADI Rd, imm`  | register, integer | `Rd ← imm`                   |
| `LOAD Rd, addr`  | register, address | `Rd ← Memory[addr]`          |
| `STORE Rs, addr` | register, address | `Memory[addr] ← Rs`          |
| `ADD Rd, Ra, Rb` | three registers   | `Rd ← Ra + Rb`               |
| `SUB Rd, Ra, Rb` | three registers   | `Rd ← Ra − Rb`               |
| `MUL Rd, Ra, Rb` | three registers   | `Rd ← Ra × Rb`               |
| `CMP Ra, Rb`     | two registers     | Zero flag ← `Ra == Rb`       |
| `JMP target`     | instruction index | Unconditional jump           |
| `JZ target`      | instruction index | Jump if the zero flag is set |
| `HALT`           | —                 | Stop execution               |

Operand rules, all enforced at load time:

- **register** — `R0`–`R3`, case-insensitive.
- **integer** — a whole number, optionally negative. `ADD` and friends take
  registers only, never a literal.
- **address** — `0`–`15`.
- **instruction index** — see below.

### Jump targets are zero-based instruction indices

This is the one thing worth calling out in class. A jump operand counts
_instructions from zero_, while the program listing and the trace display
instructions from one. So `JMP 2` lands on the instruction shown as **3** in
the listing.

Comments and blank lines are skipped before indices are assigned, so they never
shift a jump target — but they do shift the source line numbers used in error
messages. Jump targets outside the program are rejected when you load it.

### Worked example: a countdown loop

```
# Count down R0 from 3 to 0
LOADI R0, 3        # index 0
LOADI R1, 1        # index 1
CMP R0, R1         # index 2  ← loop top
SUB R0, R0, R1     # index 3
JZ 6               # index 4  → HALT once R0 has reached 0
JMP 2              # index 5  → back to CMP
HALT               # index 6
```

`CMP` runs _before_ the subtraction, so the zero flag is set on the pass where
`R0` still equals 1; the following `SUB` brings it to 0 and `JZ` then exits.
Halts after 14 instructions with `R0 = 0`.

## Load-time validation

The assembler refuses a program and explains why, rather than letting it run
into undefined behaviour:

- unknown instruction
- wrong number of operands
- an operand that should be a register but is not `R0`–`R3`
- an operand that should be a number but is not
- a memory address outside `0`–`15`
- a jump target outside the program
- an empty program

---

# 2 · MSU-1 Simulator — `#/msu1`

An interactive visualiser for **MSU-1**, the teaching machine used as the
running case study through Units I–V. Students type MSU-1 assembly, watch it
assemble into 8-bit words, and step the machine one clock cycle at a time while
the register transfers, control signals, buses and memory light up.

The two simulators answer different questions. The CPU Simulator asks _what are
the parts of a processor and what does each phase do?_ MSU-1 asks _what exactly
happens on each clock edge, and what does an instruction cost?_ Unit II is well
served by the first; Units III–V need the second.

## Why cycle-level

The unit's central slide (U3-S8) is the micro-operation table for a single
`LDA 13`: six clock cycles, four registers, one instruction. So the **Cycle**
button advances one clock cycle, not one instruction, and the Micro-operations
panel shows the live version of that table with the current row highlighted:

```
T1  fetch    MAR ← PC
T2  fetch    MDR ← M[MAR]; PC ← PC + 1
T3  decode   IR ← MDR
T4  execute  MAR ← IR[operand]
T5  execute  MDR ← M[MAR]
T6  execute  ACC ← MDR
```

The execute rows genuinely do not exist until T3 has put the opcode into IR —
until then the panel says so, which is the point.

## The machine

| Property                     | Value                                             |
| ---------------------------- | ------------------------------------------------- |
| Word size                    | 8 bits                                            |
| Memory                       | 16 locations, addresses 0–15, 8 bits each         |
| Instruction format           | 4-bit opcode + 4-bit operand, in one 8-bit word   |
| Architecture style           | von Neumann, single accumulator                   |
| Programmer-visible registers | `ACC` (8), `X` index (4), flags `Z C N V`         |
| Internal registers           | `PC` (4), `MAR` (4), `MDR` (8), `IR` (8), `B` (8) |
| Buses                        | address 4 lines, data 8 lines                     |

Code and data share **one** memory, so the memory panel shows every word read
both ways at once — _as instruction_ and _as data_. The bits do not change;
only the opcode that reaches them decides what they mean.

`B` is the ALU's second-operand latch: on `ADD`, `SUB` and `AND` it takes MDR in
the same cycle the ALU computes, which is what gives the register a job.

## Instruction set

| Opcode | Mnemonic | Operation            | Mode      | Flags     | Cycles |
| ------ | -------- | -------------------- | --------- | --------- | ------ |
| `0000` | `LDA a`  | `ACC ← M[a]`         | Direct    | `Z N`     | 6      |
| `0001` | `STA a`  | `M[a] ← ACC`         | Direct    | —         | 6      |
| `0010` | `ADD a`  | `ACC ← ACC + M[a]`   | Direct    | `Z C N V` | 6      |
| `0011` | `SUB a`  | `ACC ← ACC − M[a]`   | Direct    | `Z C N V` | 6      |
| `0100` | `LDI n`  | `ACC ← n`            | Immediate | `Z N`     | 4      |
| `0101` | `JMP a`  | `PC ← a`             | Direct    | —         | 4      |
| `0110` | `JZ a`   | `if Z=1 then PC ← a` | Direct    | —         | 4      |
| `0111` | `AND a`  | `ACC ← ACC ∧ M[a]`   | Direct    | `Z N`     | 6      |
| `1000` | `LDN a`  | `ACC ← M[M[a]]`      | Indirect  | `Z N`     | 8      |
| `1001` | `LDX a`  | `ACC ← M[a + X]`     | Indexed   | `Z N`     | 6      |
| `1010` | `INX`    | `X ← X + 1`          | Implied   | `Z`       | 4      |
| `1011` | `NOT`    | `ACC ← ¬ACC`         | Implied   | `Z N`     | 4      |
| `1100` | `SHL`    | `ACC ← ACC ≪ 1`      | Implied   | `Z C N`   | 4      |
| `1101` | `OUT`    | `display ← ACC`      | Implied   | —         | 4      |
| `1110` | —        | _reserved_           | —         | —         | —      |
| `1111` | `HLT`    | stop execution       | Implied   | —         | 4      |

The cycle counts are the teaching point: immediate needs no memory access,
direct needs one, indirect needs two — and `LDN` costs two cycles more than
`LDA` for exactly that reason.

Opcode `1110` is left undefined on purpose — it is the free slot the Unit III
case study asks students to fill. Executing it halts the machine and says so.

### Flags

`Z` zero · `C` carry out of the MSB, i.e. **unsigned** overflow · `N` MSB of the
result · `V` carry into the MSB differs from the carry out, i.e. **signed**
overflow.

One adder serves both `ADD` and `SUB` — subtraction is addition of the two's
complement, and on `SUB` a set `C` means _no borrow_. The hardware cannot know
which reading you meant, so it computes both `C` and `V` and lets the program
decide. The **Carry vs overflow** preset is `100 + 50`: `C = 0`, `V = 1`.

## Assembly syntax

Case-insensitive mnemonics, one instruction per line. Comments start with `#`,
`;` or `//`.

- `LDA 13` — an instruction. Operands are `0`–`15`; the field is only 4 bits, so
  `LDI 20` and `LDA 16` are both rejected with that reason.
- `13: 25` — an **address prefix** sets the location counter, so the listings in
  the learning material can be typed in verbatim. On its own (`13:`) it just
  moves the counter.
- `25` — a bare number is a data byte at the current location.
- `DAT 25` / `DB 25` — the same, explicitly. Several values may follow.
- `ORG 13` — set the location counter.

Numbers may be written `25`, `0x19`, `19h`, `$19`, `0b11001` or `11001b`, and
data bytes may be negative (`-45` is stored as `D3h`).

The assembler refuses a program and says why, rather than running into
undefined behaviour: unknown instruction, wrong operand count, an operand
outside `0`–`15`, a value that will not fit in 8 bits, an address written twice
by two different lines, an address past 15, or an empty program.

### Worked example — U3-S9

```
LDA 13        # ACC <- M[13] = 25
ADD 14        # ACC <- 25 + 17 = 42
STA 15        # M[15] <- 42
OUT           # display <- 42
HLT

13: 25
14: 17
```

assembles to `0D 2E 1F D0 F0` at addresses 0–4 with `19h` and `11h` at 13–14,
which is the byte-for-byte listing in the learning material. It retires 5
instructions in 26 clock cycles — CPI 5.2, shown live in the header, which is
where `CPU time = IC × CPI × clock cycle time` stops being an abstraction.

## Presets

| Preset                    | Drawn from | Shows                                                   |
| ------------------------- | ---------- | ------------------------------------------------------- |
| Add & display             | U3-S9      | The canonical trace, hand-assembly, `OUT`               |
| Carry vs overflow         | U3-S16     | `100 + 50`: `C = 0` but `V = 1`                         |
| Indirect — LDN            | U3-S11     | Pointers, and the extra memory access they cost         |
| Indexed — LDX / INX       | U3-S12     | `EA = base + X`, what a `for` loop compiles to          |
| Countdown loop            | —          | `Z`, `JZ` and `JMP`; branching without an "if"          |
| Bitwise — AND / SHL / NOT | U3-S17     | Masking, doubling, and `C` catching the shifted-out bit |

---

## Using MSU-1

1. Type a program, or pick one of the six presets — each is drawn from a slide
   in the learning material.
2. **Assemble & load** validates the source and writes it into memory.
3. **Cycle** advances one clock cycle. **Instruction** runs to the end of the
   current instruction. **Run** free-runs at the selected clock speed;
   **Reset** reloads memory from the assembled image.

Things worth pointing at while stepping:

- `PC` is incremented during **fetch** (T2), so from decode onward it already
  points at the _next_ instruction. That is why `JMP` works by overwriting a PC
  that has already moved on.
- Jump operands are **memory addresses**, not instruction numbers, because on a
  von Neumann machine that is all there is.
- Nothing stops the PC running off the end of the code into data and executing
  it. That is not a bug in the simulator — it is the stored-program concept.
- `X` and `MAR` are 4 bits, so `LDX` wraps its effective address at 16. The
  trace says so when it happens.

---

## Project layout

```
index.html                Entry point
src/main.tsx              React root
src/App.tsx               Hash router and the tab bar
src/app.css               Shell, nav, and the height overrides both apps need

src/CPUSimulator.tsx      1 · assembler, machine state, and UI
src/index.css             Reset plus .cs-* styling for the CPU Simulator

src/MSU1Simulator.tsx     2 · ISA, assembler, micro-operations, machine and UI
src/msu1.css              .m1-* styling for MSU-1
```

Each simulator is deliberately one file so it can be read top to bottom in a
lecture. `MSU1Simulator.tsx` goes: ISA table → assembler → machine state and
flag arithmetic → micro-operation sequences → the one-cycle `advance` function
→ rendering.

`app.css` is the only place the two meet: both components are written to own
the whole viewport, so the shell relaxes that from the outside rather than by
editing either file.

## Built with

React 19, TypeScript and Vite, with [lucide-react](https://lucide.dev) icons.
MSU-1 and MSU-1M are fictional teaching machines from the ITE131 materials.
