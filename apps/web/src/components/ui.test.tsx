import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { VerificationBadge } from './ui';

describe('VerificationBadge',()=>{it('renders a readable non-color status',()=>{render(<VerificationBadge status="verified_multi_source"/>);expect(screen.getByText('verified multi source')).toBeInTheDocument()})});
