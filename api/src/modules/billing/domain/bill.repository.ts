export const BILL_REPOSITORY = Symbol('BILL_REPOSITORY');

export interface Bill {
  id: string;
  tenantId: string;
  shipmentId: string;
  amountMinor: number;
  currency: string;
  status: 'draft' | 'issued' | 'paid' | 'void';
  issuedAt: Date | null;
  paidAt: Date | null;
  voidedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface BillRepository {
  insert(bill: Bill): Promise<Bill>;
  findById(id: string): Promise<Bill | null>;
  findByShipmentId(tenantId: string, shipmentId: string): Promise<Bill | null>;
  save(bill: Bill): Promise<Bill>;
}

export const BillRepositoryPort = BILL_REPOSITORY as unknown as BillRepository;
