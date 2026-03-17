import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from '../../users/entities/user.entity';
import { TransactionStatus } from '../enums/transaction-status.enum';
import { TransactionType } from '../enums/transaction-type.enum';

@Entity('transactions')
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  user_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'enum', enum: TransactionType })
  type!: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status!: TransactionStatus;

  @Column({ type: 'varchar', length: 3, nullable: true, name: 'from_currency' })
  from_currency!: string | null;

  @Column({ type: 'varchar', length: 3, name: 'to_currency' })
  to_currency!: string;

  @Column({ type: 'decimal', precision: 18, scale: 4, nullable: true, name: 'from_amount' })
  from_amount!: string | null;

  @Column({ type: 'decimal', precision: 18, scale: 4, name: 'to_amount' })
  to_amount!: string;

  @Column({ type: 'decimal', precision: 18, scale: 8, nullable: true, name: 'exchange_rate' })
  exchange_rate!: string | null;

  @Index()
  @Column({ type: 'varchar', length: 255, unique: true, nullable: true, name: 'idempotency_key' })
  idempotency_key!: string | null;

  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  @Index()
  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
