import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('fx_rates_cache')
@Index(['base_currency', 'target_currency'])
export class FxRate {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ type: 'varchar', length: 3, name: 'base_currency' })
  base_currency!: string;

  @Column({ type: 'varchar', length: 3, name: 'target_currency' })
  target_currency!: string;

  @Column({ type: 'decimal', precision: 18, scale: 8 })
  rate!: string;

  @Index()
  @Column({ type: 'timestamp', name: 'fetched_at' })
  fetched_at!: Date;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
