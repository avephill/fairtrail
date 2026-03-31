'use client';

import { useState } from 'react';
import type { ParsedQuery } from './ConfirmationCard';
import { detectLocaleCurrency } from '@/lib/currency';
import styles from './ManualEntryForm.module.css';

interface ManualEntryFormProps {
  onSubmit: (query: ParsedQuery, rawInput: string) => void;
  onCancel: () => void;
  adminCurrency: string | null;
}

function synthesizeRawInput(
  originCode: string,
  originName: string,
  destCode: string,
  destName: string,
  dateFrom: string,
  dateTo: string,
  tripType: 'one_way' | 'round_trip',
  cabinClass: string,
): string {
  const parts = [`${originCode} ${originName} to ${destCode} ${destName}`];
  parts.push(dateFrom);
  if (tripType === 'round_trip' && dateTo) {
    parts.push(`to ${dateTo}`);
  }
  parts.push(tripType === 'round_trip' ? 'round trip' : 'one way');
  if (cabinClass !== 'economy') {
    parts.push(cabinClass.replace('_', ' '));
  }
  return parts.join(' ');
}

export function ManualEntryForm({ onSubmit, onCancel, adminCurrency }: ManualEntryFormProps) {
  const [originCode, setOriginCode] = useState('');
  const [originName, setOriginName] = useState('');
  const [destCode, setDestCode] = useState('');
  const [destName, setDestName] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [tripType, setTripType] = useState<'one_way' | 'round_trip'>('round_trip');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const clearError = (field: string) => {
    setFieldErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validate = (): Record<string, string> | null => {
    const errors: Record<string, string> = {};
    const code = originCode.trim();
    const dest = destCode.trim();

    if (!/^[A-Z]{3}$/.test(code)) errors.originCode = 'Enter a 3-letter IATA code';
    if (!originName.trim()) errors.originName = 'Enter airport or city name';
    if (!/^[A-Z]{3}$/.test(dest)) errors.destCode = 'Enter a 3-letter IATA code';
    if (!destName.trim()) errors.destName = 'Enter airport or city name';
    if (!dateFrom) {
      errors.dateFrom = 'Select a departure date';
    } else {
      const today = new Date().toISOString().split('T')[0]!;
      if (dateFrom < today) errors.dateFrom = 'Date cannot be in the past';
    }
    if (tripType === 'round_trip') {
      if (!dateTo) {
        errors.dateTo = 'Select a return date';
      } else if (dateFrom && dateTo < dateFrom) {
        errors.dateTo = 'Return must be after departure';
      }
    }

    return Object.keys(errors).length > 0 ? errors : null;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validate();
    if (errors) {
      setFieldErrors(errors);
      return;
    }

    const code = originCode.trim();
    const dest = destCode.trim();
    const oName = originName.trim();
    const dName = destName.trim();

    const query: ParsedQuery = {
      origin: code,
      originName: oName,
      destination: dest,
      destinationName: dName,
      origins: [{ code, name: oName }],
      destinations: [{ code: dest, name: dName }],
      dateFrom,
      dateTo: tripType === 'round_trip' ? dateTo : dateFrom,
      flexibility: 0,
      maxPrice: null,
      maxStops: null,
      preferredAirlines: [],
      timePreference: 'any',
      cabinClass: 'economy',
      tripType,
      currency: adminCurrency || detectLocaleCurrency(),
    };

    const rawInput = synthesizeRawInput(code, oName, dest, dName, dateFrom, dateTo, tripType, 'economy');
    onSubmit(query, rawInput);
  };

  const today = new Date().toISOString().split('T')[0]!;

  return (
    <form className={styles.root} onSubmit={handleSubmit} noValidate>
      <div className={styles.sectionLabel}>Origin</div>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="me-origin-code">IATA Code</label>
          <input
            id="me-origin-code"
            className={`${styles.input} ${fieldErrors.originCode ? styles.inputError : ''}`}
            type="text"
            placeholder="JFK"
            maxLength={3}
            value={originCode}
            onChange={(e) => { setOriginCode(e.target.value.toUpperCase()); clearError('originCode'); }}
            autoFocus
            aria-required
            aria-invalid={!!fieldErrors.originCode}
          />
          {fieldErrors.originCode && <span className={styles.errorText}>{fieldErrors.originCode}</span>}
        </div>
        <div className={`${styles.field} ${styles.fieldGrow}`}>
          <label className={styles.label} htmlFor="me-origin-name">City / Airport</label>
          <input
            id="me-origin-name"
            className={`${styles.input} ${fieldErrors.originName ? styles.inputError : ''}`}
            type="text"
            placeholder="New York JFK"
            value={originName}
            onChange={(e) => { setOriginName(e.target.value); clearError('originName'); }}
            aria-required
            aria-invalid={!!fieldErrors.originName}
          />
          {fieldErrors.originName && <span className={styles.errorText}>{fieldErrors.originName}</span>}
        </div>
      </div>

      <div className={styles.sectionLabel}>Destination</div>
      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="me-dest-code">IATA Code</label>
          <input
            id="me-dest-code"
            className={`${styles.input} ${fieldErrors.destCode ? styles.inputError : ''}`}
            type="text"
            placeholder="CDG"
            maxLength={3}
            value={destCode}
            onChange={(e) => { setDestCode(e.target.value.toUpperCase()); clearError('destCode'); }}
            aria-required
            aria-invalid={!!fieldErrors.destCode}
          />
          {fieldErrors.destCode && <span className={styles.errorText}>{fieldErrors.destCode}</span>}
        </div>
        <div className={`${styles.field} ${styles.fieldGrow}`}>
          <label className={styles.label} htmlFor="me-dest-name">City / Airport</label>
          <input
            id="me-dest-name"
            className={`${styles.input} ${fieldErrors.destName ? styles.inputError : ''}`}
            type="text"
            placeholder="Paris CDG"
            value={destName}
            onChange={(e) => { setDestName(e.target.value); clearError('destName'); }}
            aria-required
            aria-invalid={!!fieldErrors.destName}
          />
          {fieldErrors.destName && <span className={styles.errorText}>{fieldErrors.destName}</span>}
        </div>
      </div>

      <div className={styles.tripToggle}>
        <button
          type="button"
          className={`${styles.tripOption} ${tripType === 'round_trip' ? styles.tripOptionActive : ''}`}
          onClick={() => setTripType('round_trip')}
        >
          Round trip
        </button>
        <button
          type="button"
          className={`${styles.tripOption} ${tripType === 'one_way' ? styles.tripOptionActive : ''}`}
          onClick={() => setTripType('one_way')}
        >
          One way
        </button>
      </div>

      <div className={styles.fieldRow}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="me-date-from">Departure</label>
          <input
            id="me-date-from"
            className={`${styles.input} ${fieldErrors.dateFrom ? styles.inputError : ''}`}
            type="date"
            min={today}
            value={dateFrom}
            onChange={(e) => { setDateFrom(e.target.value); clearError('dateFrom'); }}
            aria-required
            aria-invalid={!!fieldErrors.dateFrom}
          />
          {fieldErrors.dateFrom && <span className={styles.errorText}>{fieldErrors.dateFrom}</span>}
        </div>
        {tripType === 'round_trip' && (
          <div className={styles.field}>
            <label className={styles.label} htmlFor="me-date-to">Return</label>
            <input
              id="me-date-to"
              className={`${styles.input} ${fieldErrors.dateTo ? styles.inputError : ''}`}
              type="date"
              min={dateFrom || today}
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); clearError('dateTo'); }}
              aria-required
              aria-invalid={!!fieldErrors.dateTo}
            />
            {fieldErrors.dateTo && <span className={styles.errorText}>{fieldErrors.dateTo}</span>}
          </div>
        )}
      </div>

      <div className={styles.actions}>
        <button type="submit" className={styles.submitButton}>
          Show available flights
        </button>
        <button type="button" className={styles.cancelButton} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
