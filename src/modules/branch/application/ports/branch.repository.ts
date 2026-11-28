import type {
  Branch,
  BranchInput,
  CashShift,
  DeliveryZoneInput,
  Page,
  PageInput,
  PosTerminal,
} from "../../domain/branch.js";

export interface BranchRepository {
  listBranches(input: PageInput & { includeInactive: boolean }): Promise<Page<Branch>>;
  findBranch(id: string): Promise<Branch | null>;
  createBranch(input: BranchInput): Promise<Branch>;
  updateBranch(id: string, input: Partial<BranchInput>): Promise<Branch>;
  replaceDeliveryZones(branchId: string, zones: DeliveryZoneInput[]): Promise<Branch>;
  listTerminals(
    input: PageInput & { branchId: string; terminalIds: string[] | null },
  ): Promise<Page<PosTerminal>>;
  findTerminal(id: string): Promise<(PosTerminal & { branchIsActive: boolean }) | null>;
  createTerminal(input: { branchId: string; code: string }): Promise<PosTerminal>;
  hasOpenShift(branchId: string): Promise<boolean>;
  listShifts(
    input: PageInput & {
      branchId: string;
      terminalIds: string[] | null;
      status?: "OPEN" | "CLOSED";
    },
  ): Promise<Page<CashShift>>;
  findShift(id: string): Promise<CashShift | null>;
  openShift(input: {
    terminalId: string;
    openedById: string;
    openedAt: Date;
    openingCashVnd: number;
  }): Promise<CashShift>;
  closeShift(
    id: string,
    input: { closedById: string; closedAt: Date; closingCashVnd: number; note: string | null },
  ): Promise<CashShift>;
}

export interface BranchUnitOfWork {
  run<T>(work: (repository: BranchRepository) => Promise<T>): Promise<T>;
}
