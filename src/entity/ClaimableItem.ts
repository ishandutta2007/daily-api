import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { User } from './user';
import type { SubscriptionCycles } from '../paddle';
import type { SubscriptionProvider, SubscriptionStatus } from '../common/plus';

export enum ClaimableItemTypes {
  Plus = 'plus',
}

export type ClaimableItemFlags = {
  cycle: SubscriptionCycles | null;
  createdAt: Date | null;
  subscriptionId: string | null;
  provider: SubscriptionProvider | null;
  status: SubscriptionStatus | null;
};

@Entity()
export class ClaimableItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  @Index('IDX_claimable_item_email')
  email: string;

  @Column({ default: () => 'now()' })
  createdAt: Date;

  @Column({ nullable: true })
  claimedAt?: Date;

  @Column()
  type: ClaimableItemTypes;

  @Column({ type: 'jsonb', default: {} })
  flags: ClaimableItemFlags;

  @Column({ nullable: true })
  claimedById?: string;

  @ManyToOne('User', { lazy: true, onDelete: 'CASCADE' })
  claimedBy?: Promise<User>;
}
