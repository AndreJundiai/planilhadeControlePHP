<!DOCTYPE html>
<html>
<head>
    <title>Consulta de Registros</title>
    <style>
        body { font-family: Arial, sans-serif; padding: 20px; }
        h1 { text-align: center; }
        table { width: 100%; border-collapse: collapse; margin-top: 25px; }
        table th, table td { padding: 12px; text-align: left; border-bottom: 1px solid #ddd; }
        table th { background-color: #f2f2f2; }
        .error { color: red; text-align: center; }
    </style>
</head>
<body>

<h1 id="user-name">Carregando...</h1>

<table id="records-table" style="display:none;">
    <thead>
        <tr>
            <th>Dia</th>
            <th>Dia da Semana</th>
            <th>Hora Entrada</th>
            <th>Início do Almoço</th>
            <th>Fim do Almoço</th>
            <th>Hora da Saída</th>
            <th>Banco de Horas em minutos</th>
        </tr>
    </thead>
    <tbody id="records-body"></tbody>
</table>

<p id="error-message" class="error" style="display:none;"></p>

<script>
    // Faz a requisição para a API
    fetch("consultaAPi.php")
        .then(response => response.json())
        .then(data => {
            if (data.erro) {
                document.getElementById("error-message").textContent = data.erro;
                document.getElementById("error-message").style.display = "block";
                return;
            }

            // Exibe o nome do usuário
            document.getElementById("user-name").textContent = data.nomeUsuario;

            // Exibe os registros
            const tableBody = document.getElementById("records-body");
            if (data.registros.length > 0) {
                data.registros.forEach(registro => {
                    const row = `<tr>
                        <td>${registro.dia}</td>
                        <td>${registro.diaSemana}</td>
                        <td>${registro.hora_entrada}</td>
                        <td>${registro.hora_almoço_entrada}</td>
                        <td>${registro.hora_almoço_saida}</td>
                        <td>${registro.hora_saida}</td>
                        <td>${registro.bancodeHoras}</td>
                    </tr>`;
                    tableBody.innerHTML += row;
                });
                document.getElementById("records-table").style.display = "table";
            } else {
                document.getElementById("error-message").textContent = "Nenhum registro encontrado.";
                document.getElementById("error-message").style.display = "block";
            }
        })
        .catch(error => {
            document.getElementById("error-message").textContent = "Erro ao buscar os dados.";
            document.getElementById("error-message").style.display = "block";
        });
</script>

</body>
</html>
