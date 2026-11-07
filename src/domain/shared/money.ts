import { Decimal } from 'decimal.js';

export interface MoneyProps {
  amount: string;   // ex.: "25.00"
  currency: string; // ISO-4217, ex.: "BRL"
}

export class CurrencyMismatchError extends Error {
  constructor(expected: string, received: string) {
    super(`Currency mismatch: expected ${expected}, got ${received}`);
    this.name = 'CurrencyMismatchError';
  }
}

export class InvalidMoneyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidMoneyError';
  }
}

export class Money {
  // Regex para validar string decimal estrita com no máximo 2 casas decimais.
  // Aceita: "0.00", "25.50", "-10.00", etc.
  // Rejeita: notação científica ("1e5"), letras, caracteres especiais, mais de 2 casas decimais ("25.001").
  private static readonly DECIMAL_REGEX = /^-?\d+(\.\d{2})?$/;

  private constructor(
    private readonly value: Decimal,
    public readonly currency: string,
  ) {}

  /**
   * Factory method para criar Money a partir de uma DTO/Props.
   * Valida rigorosamente as entradas.
   */
  static from(props: MoneyProps): Money {
    if (!props.amount || typeof props.amount !== 'string') {
      throw new InvalidMoneyError('Amount must be a non-empty string');
    }

    if (!props.currency || typeof props.currency !== 'string' || props.currency.trim().length !== 3) {
      throw new InvalidMoneyError('Currency must be a 3-letter ISO-4217 string (e.g. BRL)');
    }

    const trimmedAmount = props.amount.trim();

    if (!Money.DECIMAL_REGEX.test(trimmedAmount)) {
      throw new InvalidMoneyError(
        `Invalid amount format: "${props.amount}". Must be a decimal string with at most 2 decimal places and no scientific notation.`
      );
    }

    let decimalValue: Decimal;
    try {
      decimalValue = new Decimal(trimmedAmount);
    } catch {
      throw new InvalidMoneyError(`Could not parse amount "${props.amount}" to Decimal`);
    }

    if (!decimalValue.isFinite()) {
      throw new InvalidMoneyError('Amount cannot be NaN or Infinity');
    }

    return new Money(decimalValue, props.currency.toUpperCase());
  }

  /**
   * Cria um valor zerado ("0.00") para a moeda indicada.
   */
  static zero(currency: string): Money {
    return Money.from({ amount: '0.00', currency });
  }

  /**
   * Soma dois valores monetários.
   * Retorna uma NOVA instância (imutabilidade).
   */
  add(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.plus(other.value), this.currency);
  }

  /**
   * Subtrai outro valor monetário deste.
   * Retorna uma NOVA instância (imutabilidade).
   */
  subtract(other: Money): Money {
    this.assertSameCurrency(other);
    return new Money(this.value.minus(other.value), this.currency);
  }

  /**
   * Inverte o sinal (positivo vira negativo e vice-versa).
   */
  negate(): Money {
    return new Money(this.value.negated(), this.currency);
  }

  isZero(): boolean {
    return this.value.isZero();
  }

  isPositive(): boolean {
    return this.value.isPositive() && !this.value.isZero();
  }

  isNegative(): boolean {
    return this.value.isNegative();
  }

  isLessThan(other: Money): boolean {
    this.assertSameCurrency(other);
    return this.value.lessThan(other.value);
  }

  equals(other: Money): boolean {
    return this.currency === other.currency && this.value.equals(other.value);
  }

  /**
   * Retorna sempre a representação exata com 2 casas decimais.
   */
  toString(): string {
    return this.value.toFixed(2);
  }

  toJSON(): MoneyProps {
    return {
      amount: this.toString(),
      currency: this.currency,
    };
  }

  private assertSameCurrency(other: Money): void {
    if (this.currency !== other.currency) {
      throw new CurrencyMismatchError(this.currency, other.currency);
    }
  }
}