<?php

// Define o nome do arquivo
$filename = 'registro_jornada_2025.csv';

// Abre o arquivo para escrita
$file = fopen($filename, 'w');

// Escreve o cabeçalho
fputcsv($file, ['Dia', 'Hora Entrada', 'Início do Almoço', 'Fim do Almoço', 'Hora da Saída', 'IdUsuario', 'Dia da Semana']);

// Define os dados e preenche o arquivo
$startDate = new DateTime('2025-01-01');
$endDate = new DateTime('2025-12-31');
$idUsuario = 6;

// Função para obter o dia da semana
function obterDiaSemana($data) {
    $diaDaSemana = $data->format('N');
    $dias = [
        6 => "Sábado",
        7 => "Domingo"
    ];

    return $dias[$diaDaSemana] ?? "";
}

while ($startDate <= $endDate) {
    // Define os valores para cada dia
    $dia = $startDate->format('d/m/Y');
    $horaEntrada = '08:00:00'; // Exemplo, ajuste conforme necessário
    $inicioAlmoço = '12:00:00'; // Exemplo, ajuste conforme necessário
    $fimAlmoço = '13:00:00'; // Exemplo, ajuste conforme necessário
    $horaSaida = '17:00:00'; // Exemplo, ajuste conforme necessário
    $diaSemana = obterDiaSemana($startDate);

    // Preenche a linha com os dados
    fputcsv($file, [$dia, $horaEntrada, $inicioAlmoço, $fimAlmoço, $horaSaida, $idUsuario, $diaSemana]);

    // Move para a próxima data
    $startDate->modify('+1 day');
}

// Fecha o arquivo
fclose($file);

echo "Arquivo CSV criado com sucesso!";
?>
