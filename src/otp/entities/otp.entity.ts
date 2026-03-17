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
import { OtpType } from '../enums/otp-type.enum';

@Entity('otp_codes')
export class Otp {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Index()
  @Column({ type: 'uuid', name: 'user_id' })
  user_id!: string;

  @ManyToOne(() => User)
  @JoinColumn({ name: 'user_id' })
  user!: User;

  @Column({ type: 'varchar', length: 6 })
  code!: string;

  @Column({ type: 'enum', enum: OtpType })
  type!: OtpType;

  @Column({ type: 'timestamp', name: 'expires_at' })
  expires_at!: Date;

  @Column({ type: 'boolean', default: false, name: 'is_used' })
  is_used!: boolean;

  @CreateDateColumn({ name: 'created_at' })
  created_at!: Date;
}
