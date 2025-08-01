import { Column, Entity, ManyToMany, PrimaryColumn } from 'typeorm';
import type { UserExperience } from './experiences/UserExperience';

@Entity()
export class UserSkill {
  @PrimaryColumn({
    type: 'text',
    update: false,
    insert: false,
    nullable: false,
    unique: true,
    generatedType: 'STORED',
    asExpression: `trim(BOTH '-' FROM regexp_replace(lower(trim(COALESCE(LEFT(name,100),''))), '[^a-z0-9-]+', '-', 'gi'))`,
  })
  slug: string;

  @Column({ type: 'text', unique: true })
  name: string;

  @Column({ type: 'text', nullable: true })
  description: string;

  @ManyToMany(
    'UserExperience',
    (experience: UserExperience) => experience.skills,
  )
  experiences: Promise<UserExperience[]>;
}
