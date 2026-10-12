import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CustomersModule } from '../customers/customers.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { ShipmentsModule } from '../shipments/shipments.module.js';
import { TenantsModule } from '../tenants/tenants.module.js';
import { OtpEmailsListener } from './application/otp-emails.listener.js';
import { ProofsService } from './application/proofs.service.js';
import { PROOF_REPOSITORY } from './domain/proof.repository.js';
import { ProofOrmEntity } from './infrastructure/proof.orm-entity.js';
import { TypeOrmProofRepository } from './infrastructure/typeorm-proof.repository.js';
import { ProofOfDeliveryController } from './presentation/proof-of-delivery.controller.js';

/**
 * Proof of delivery module: the evidence a parcel reached a human.
 *
 * Owns `proofs_of_delivery` (append-only) and the OTP columns on shipments.
 * Imports the shipments facade for actor scoping and status checks; ships
 * reads its table through the raw {@link DELIVERY_PROOF_READ} port on the
 * other side, so neither module imports the other twice — no cycle.
 *
 * The listener issues the delivery OTP when a shipment goes out for
 * delivery (only for tenants that demand proof), and the controller exposes
 * capture, verification, and listing.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([ProofOrmEntity]),
    IdentityModule,
    ShipmentsModule,
    CustomersModule,
    NotificationsModule,
    TenantsModule,
  ],
  controllers: [ProofOfDeliveryController],
  providers: [
    ProofsService,
    OtpEmailsListener,
    TypeOrmProofRepository,
    { provide: PROOF_REPOSITORY, useClass: TypeOrmProofRepository },
  ],
  exports: [ProofsService],
})
export class ProofOfDeliveryModule {}
