import { z } from 'zod';
import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { SubscriptionCycles } from '../paddle';
import { SubscriptionProvider, SubscriptionStatus } from '../common/plus';
import type { ContentPreferenceOrganization } from './contentPreference/ContentPreferenceOrganization';

export const organizationSubscriptionFlagsSchema = z.object({
  subscriptionId: z.string({ message: 'Subscription ID is required' }),
  priceId: z.string({ message: 'Price ID is required' }),
  cycle: z.nativeEnum(SubscriptionCycles, {
    message: 'Invalid subscription cycle',
  }),
  createdAt: z.preprocess(
    (value) => new Date(value as string),
    z.date().optional(),
  ),
  provider: z.nativeEnum(SubscriptionProvider, {
    message: 'Invalid subscription provider',
  }),
  status: z.nativeEnum(SubscriptionStatus, {
    message: 'Invalid subscription status',
  }),
});

@Entity()
@Index('IDX_organization_subflags_subscriptionid', { synchronize: false })
export class Organization {
  @PrimaryColumn({
    type: 'text',
    primaryKeyConstraintName: 'PK_organization_organization_id',
  })
  id: string;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  image: string;

  @Column({ type: 'smallint', default: 1 })
  seats: number;

  @Column({ type: 'jsonb', default: {} })
  subscriptionFlags: z.infer<typeof organizationSubscriptionFlagsSchema>;

  @OneToMany(
    'ContentPreferenceOrganization',
    (sm: ContentPreferenceOrganization) => sm.organization,
    { lazy: true },
  )
  members: Promise<ContentPreferenceOrganization[]>;
}
