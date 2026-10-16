import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TransactionHost } from '@nestjs-cls/transactional';
import { TransactionalAdapterTypeOrm } from '@nestjs-cls/transactional-adapter-typeorm';
import { TenantContextService } from '../../../shared/tenancy/tenant-context.service.js';
import { Bill as BillEntity } from './bill.orm-entity.js';
import {
  Bill,
  BillRepository,
} from '../domain/bill.repository.js';

@Injectable()
export class TypeOrmBillRepository implements BillRepository {
  private readonly repository: Repository<BillEntity>;

  constructor(
    @InjectRepository(BillEntity)
    repository: Repository<BillEntity>,
    private readonly txHost: TransactionHost<TransactionalAdapterTypeOrm>,
    private readonly tenants: TenantContextService,
  ) {
    this.repository = txHost.tx.getRepository(BillEntity) ?? repository;
  }

  async insert(bill: Bill): Promise<Bill> {
    this.assertTenant(bill.tenantId);
    const entity = this.mapToEntity(bill);
    const saved = await this.repository.save(entity);
    return this.mapToDomain(saved);
  }

  async findById(id: string): Promise<Bill | null> {
    const entity = await this.repository.findOne({
      where: { id, ...this.tenants.scope() },
    });
    return entity ? this.mapToDomain(entity) : null;
  }

  async findByShipmentId(tenantId: string, shipmentId: string): Promise<Bill | null> {
    const entity = await this.repository.findOne({ where: { tenantId, shipmentId } });
    return entity ? this.mapToDomain(entity) : null;
  }

  async save(bill: Bill): Promise<Bill> {
    this.assertTenant(bill.tenantId);
    const entity = this.mapToEntity(bill);
    const saved = await this.repository.save(entity);
    return this.mapToDomain(saved);
  }

  /** Refuses to write a bill for a tenant other than the active one. */
  private assertTenant(tenantId: string): void {
    const active = this.tenants.getTenantId();
    if (active !== undefined && active !== tenantId) {
      throw new Error(
        `Refusing to write a bill for tenant ${tenantId} from tenant ${active}.`,
      );
    }
  }

  private mapToDomain(entity: BillEntity): Bill {
    return {
      id: entity.id,
      tenantId: entity.tenantId,
      shipmentId: entity.shipmentId,
      amountMinor: entity.amountMinor,
      currency: entity.currency,
      status: entity.status,
      issuedAt: entity.issuedAt,
      paidAt: entity.paidAt,
      voidedAt: entity.voidedAt,
      version: entity.version,
      createdAt: entity.createdAt,
      updatedAt: entity.updatedAt,
    };
  }

  private mapToEntity(bill: Bill): BillEntity {
    const entity = new BillEntity();
    entity.id = bill.id;
    entity.tenantId = bill.tenantId;
    entity.shipmentId = bill.shipmentId;
    entity.amountMinor = bill.amountMinor;
    entity.currency = bill.currency;
    entity.status = bill.status;
    entity.issuedAt = bill.issuedAt;
    entity.paidAt = bill.paidAt;
    entity.voidedAt = bill.voidedAt;
    entity.version = bill.version;
    entity.createdAt = bill.createdAt;
    entity.updatedAt = bill.updatedAt;
    return entity;
  }
}
